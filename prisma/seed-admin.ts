/**
 * Creates (or resets the password of) an admin account.
 *   ADMIN_EMAIL=owner@dailymeat.in ADMIN_PHONE=+919876543210 ADMIN_PASSWORD='a-strong-one' npm run seed:admin
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function main() {
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const phone = process.env.ADMIN_PHONE;
  const password = process.env.ADMIN_PASSWORD;
  if ((!email && !phone) || !password) {
    throw new Error('Set ADMIN_PASSWORD and at least one of ADMIN_EMAIL / ADMIN_PHONE.');
  }
  if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');

  const prisma = new PrismaClient();
  try {
    const hash = await bcrypt.hash(password, 10);
    const existing = await prisma.user.findFirst({ where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] } });
    const admin = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN', password: hash, isActive: true, tokensValidAfter: new Date(), refreshToken: null } })
      : await prisma.user.create({ data: { name: 'Admin', email: email ?? null, phone: phone ?? null, password: hash, role: 'ADMIN', isProfileCompleted: true } });
    console.log(`${existing ? 'Updated' : 'Created'} admin ${admin.email ?? admin.phone} (${admin.id})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
