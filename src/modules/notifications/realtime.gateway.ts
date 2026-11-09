import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthUser } from '../../common/decorators';
import { DomainEvents, DriverLocationEvent } from '../../common/events/domain-events';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { UsersService } from '../users/users.service';

export const Rooms = {
  user: (id: string) => `user_${id}`,
  order: (id: string) => `order_${id}`,
  admins: 'admin_room',
} as const;

type AuthedSocket = Socket & { data: { user: AuthUser } };

/**
 * Socket.IO endpoint. Clients authenticate with the same access token as the REST API.
 * Rooms: user_<id> (personal), admin_room (all admins), order_<id> (live tracking, access-checked).
 */
@WebSocketGateway({ cors: { origin: true }, pingInterval: 25_000, pingTimeout: 20_000 })
export class RealtimeGateway implements OnGatewayInit {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
    private readonly tracking: TrackingService,
  ) {}

  afterInit(server: Server) {
    server.use(async (socket, next) => {
      try {
        const bearer = socket.handshake.headers?.authorization;
        const token =
          (socket.handshake.auth?.token as string | undefined) ||
          (bearer?.startsWith('Bearer ') ? bearer.slice(7) : undefined);
        if (!token) return next(new Error('AUTH_REQUIRED'));

        const payload = await this.jwt.verifyAsync<{ sub: string; iat: number }>(token, {
          secret: this.config.getOrThrow('JWT_SECRET'),
        });
        const user = await this.users.findAuthUser(payload.sub);
        if (!user || !user.isActive) return next(new Error('AUTH_INVALID'));
        if (user.tokensValidAfter && payload.iat < Math.floor(user.tokensValidAfter / 1000)) {
          return next(new Error('SESSION_ENDED'));
        }
        (socket as AuthedSocket).data.user = { id: user.id, role: user.role, name: user.name, phone: user.phone, email: user.email };
        next();
      } catch {
        next(new Error('AUTH_INVALID'));
      }
    });
  }

  handleConnection(socket: AuthedSocket) {
    const user = socket.data.user;
    if (!user) return;
    void socket.join(Rooms.user(user.id));
    if (user.role === 'ADMIN') void socket.join(Rooms.admins);
  }

  @SubscribeMessage('subscribeToOrder')
  async subscribeToOrder(@ConnectedSocket() socket: AuthedSocket, @MessageBody() orderId: string) {
    const user = socket.data.user;
    const id = String(orderId ?? '');
    // Customers can watch their own orders, drivers the ones they carry, admins any.
    const allowed =
      user.role === 'ADMIN' ||
      !!(await this.prisma.order.findFirst({
        where: { id, ...(user.role === 'DRIVER' ? { driverId: user.id } : { userId: user.id }) },
        select: { id: true },
      }));
    if (!allowed) return { ok: false, error: 'FORBIDDEN' };

    await socket.join(Rooms.order(id));
    const last = await this.tracking.lastLocation(id);
    if (last) socket.emit('orderLocationUpdate', last);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribeFromOrder')
  async unsubscribe(@ConnectedSocket() socket: AuthedSocket, @MessageBody() orderId: string) {
    await socket.leave(Rooms.order(String(orderId)));
    return { ok: true };
  }

  // ---------- server -> clients ----------

  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(Rooms.user(userId)).emit(event, payload);
  }

  toAdmins(event: string, payload: unknown) {
    this.server?.to(Rooms.admins).emit(event, payload);
  }

  toOrder(orderId: string, event: string, payload: unknown) {
    this.server?.to(Rooms.order(orderId)).emit(event, payload);
  }

  /** Kicks every admin socket (used by "log out all admins"). */
  forceLogoutAdmins() {
    this.server?.to(Rooms.admins).emit('forceLogout', { code: 'SESSION_ENDED', message: 'You have been logged out from all devices.' });
    this.server?.in(Rooms.admins).disconnectSockets(true);
  }

  @OnEvent(DomainEvents.DriverLocationUpdated)
  onDriverLocation(e: DriverLocationEvent) {
    const payload = {
      latitude: e.latitude,
      longitude: e.longitude,
      speed: e.speed,
      heading: e.heading,
      timestamp: new Date().toISOString(),
    };
    for (const id of e.orderIds) this.toOrder(id, 'orderLocationUpdate', payload);
  }
}
