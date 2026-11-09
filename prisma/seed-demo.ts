/** Local development data: one hub, a category, a product with two variants, a delivery slot and a driver. */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function main() {
  const prisma = new PrismaClient();
  try {
    if ((await prisma.hub.count()) === 0) {
      await prisma.hub.create({
        data: {
          name: 'Demo Hub',
          latitude: 13.0827,
          longitude: 80.2707,
          deliverablePincodes: JSON.stringify([]), // empty = serves every pincode
          deliveryFeeAmount: 40,
          minOrderForFreeDelivery: 500,
          storeStartTime: '00:00',
          storeCloseTime: '23:59',
        },
      });
    }
    const category = await prisma.category.upsert({ where: { name: 'Chicken' }, update: {}, create: { name: 'Chicken', sortOrder: 1 } });
    if ((await prisma.product.count({ where: { categoryId: category.id } })) === 0) {
      await prisma.product.create({
        data: {
          categoryId: category.id,
          name: 'Chicken Curry Cut',
          isPopular: true,
          variants: {
            create: [
              { weight: '500g', price: 120, discountedPrice: 110, costPrice: 80 },
              { weight: '1kg', price: 230, costPrice: 160 },
            ],
          },
        },
      });
    }
    if ((await prisma.deliverySlot.count()) === 0) {
      await prisma.deliverySlot.create({ data: { startTime: '09:00', endTime: '11:00', label: 'Morning: 9 AM - 11 AM' } });
    }
    if (!(await prisma.user.findUnique({ where: { phone: '+919000000001' } }))) {
      await prisma.user.create({
        data: { name: 'Demo Driver', phone: '+919000000001', role: 'DRIVER', password: await bcrypt.hash('driver1234', 10), isProfileCompleted: true },
      });
    }
    console.log('Demo data ready (driver: +919000000001 / driver1234).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
