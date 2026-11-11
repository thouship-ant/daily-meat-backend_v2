/**
 * Logs DEACTIVATED accounts (users.is_active = false) out of all devices.
 * Signing in is already refused for a deactivated account, and deactivating one in the app ends its sessions at once;
 * this is for accounts that were switched off some other way (SQL, the v1 backend, an import) and still hold a session.
 * Access tokens issued before now are rejected, refresh tokens are cleared and push tokens are removed.
 *
 *   npm run logout:deactivated -- --list                    who is deactivated (id, name, phone, role, still signed in?)
 *   npm run logout:deactivated                              log out every deactivated account that still has a session
 *   npm run logout:deactivated -- --user=<user_id>          log out one user (any account, deactivated or not)
 *   npm run logout:deactivated -- --role=CUSTOMER           only CUSTOMER, DRIVER, ADMIN or SUPERADMIN (default: all)
 *   npm run logout:deactivated -- --dry-run                 only show what would happen, change nothing
 *   npm run logout:deactivated -- --list --include-deleted  also the accounts a customer deleted (anonymised)
 *
 * On the server:  $C run --rm tools npm run logout:deactivated -- --user=<user_id>
 * The API caches a user for 30 seconds, so a running API stops accepting the old session within half a minute.
 * Re-running is harmless: accounts that already have no session or push token are skipped.
 */
import { Prisma, PrismaClient, Role } from '@prisma/client';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.length ? rest.join('=') : true];
  }),
) as Record<string, string | true>;

const ROLES = ['CUSTOMER', 'DRIVER', 'ADMIN', 'SUPERADMIN'] as const;
const ROLE = String(args.role ?? 'ALL').toUpperCase();
const DRY_RUN = !!args['dry-run'];
const LIST = !!args.list;
const USER_ID = args.user === undefined ? null : args.user === true ? '' : String(args.user).trim();
const INCLUDE_DELETED = !!args['include-deleted'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hasSession: Prisma.UserWhereInput = {
  OR: [{ refreshToken: { not: null } }, { pushToken: { not: null } }, { pushDevices: { not: Prisma.DbNull } }],
};
const logoutData: Prisma.UserUpdateInput = {
  tokensValidAfter: new Date(),
  refreshToken: null,
  pushToken: null,
  pushDevices: Prisma.DbNull,
};
const ist = (d: Date | null) => (d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) : null);

async function main() {
  if (ROLE !== 'ALL' && !(ROLES as readonly string[]).includes(ROLE)) {
    throw new Error('--role must be CUSTOMER, DRIVER, ADMIN, SUPERADMIN or ALL.');
  }
  if (USER_ID !== null && !UUID.test(USER_ID)) throw new Error('--user must be a user id (a UUID like 3f2b8c1e-....).');

  const prisma = new PrismaClient();
  try {
    const roleWhere: Prisma.UserWhereInput = ROLE === 'ALL' ? {} : { role: ROLE as Role };

    // ---- log out one user ----------------------------------------------------------------------------------
    if (USER_ID) {
      const u = await prisma.user.findUnique({ where: { id: USER_ID } });
      if (!u) throw new Error(`No user with id ${USER_ID}.`);
      const signedIn = !!(u.refreshToken || u.pushToken || u.pushDevices);
      const label = `${u.name || '(no name)'} ${u.phone || u.email || ''} [${u.role}${u.isActive ? '' : ', deactivated'}] ${u.id}`;
      if (DRY_RUN) {
        console.log(`Dry run: ${label} ${signedIn ? 'would be logged out.' : 'has no session or push token, nothing to do.'}`);
      } else {
        await prisma.user.update({ where: { id: USER_ID }, data: logoutData });
        console.log(`Logged out ${label} from all devices.`);
      }
      return;
    }

    // ---- list the deactivated users ------------------------------------------------------------------------
    if (LIST) {
      const deleted: Prisma.UserWhereInput = { phone: { startsWith: 'del_' } };
      const rows = await prisma.user.findMany({
        where: { isActive: false, ...roleWhere, ...(INCLUDE_DELETED ? {} : { NOT: deleted }) },
        select: { id: true, name: true, phone: true, email: true, role: true, additionalRoles: true, refreshToken: true, pushToken: true, pushDevices: true, lastActiveAt: true, updatedAt: true },
        orderBy: [{ role: 'asc' }, { updatedAt: 'desc' }],
      });
      if (!rows.length) {
        console.log('No deactivated accounts.');
      } else {
        console.table(
          rows.map((r) => ({
            user_id: r.id,
            name: r.name,
            phone: r.phone ?? r.email,
            role: [r.role, ...r.additionalRoles].join('+'),
            still_signed_in: r.refreshToken || r.pushToken || r.pushDevices ? 'YES' : '-',
            last_active_ist: ist(r.lastActiveAt),
            updated_ist: ist(r.updatedAt),
          })),
        );
        const signedIn = rows.filter((r) => r.refreshToken || r.pushToken || r.pushDevices).length;
        console.log(`${rows.length} deactivated account(s), ${signedIn} still signed in.`);
        console.log('Log one out:  npm run logout:deactivated -- --user=<user_id>      Log all of them out:  npm run logout:deactivated');
      }
      if (!INCLUDE_DELETED) {
        const hidden = await prisma.user.count({ where: { isActive: false, ...roleWhere, ...deleted } });
        if (hidden) console.log(`(${hidden} account(s) deleted by the customer are hidden: add --include-deleted to show them.)`);
      }
      return;
    }

    // ---- log out every deactivated account that still has a session ----------------------------------------
    const where: Prisma.UserWhereInput = { isActive: false, ...roleWhere, ...hasSession };
    const who = ROLE === 'ALL' ? '' : `${ROLE.toLowerCase()} `;
    if (DRY_RUN) {
      const n = await prisma.user.count({ where });
      console.log(`Dry run: ${n} deactivated ${who}account(s) still have a session or push token and would be logged out.`);
    } else {
      const { count } = await prisma.user.updateMany({ where, data: logoutData });
      console.log(`Logged out ${count} deactivated ${who}account(s) from all devices.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Failed:', e.message ?? e);
  process.exit(1);
});
