import { missingColumns } from './prisma.service';

const models = [
  { name: 'Order', dbName: 'orders', fields: [{ name: 'id', kind: 'scalar' }, { name: 'paymentAttempts', dbName: 'payment_attempts', kind: 'scalar' }, { name: 'user', kind: 'object' }] },
  { name: 'User', dbName: 'users', fields: [{ name: 'id', kind: 'scalar' }] },
];

describe('missingColumns', () => {
  it('reports a column the code expects but the database lacks (a migration that was not applied)', () => {
    const db = [{ table_name: 'orders', column_name: 'id' }, { table_name: 'users', column_name: 'id' }];
    expect(missingColumns(models, db)).toEqual(['orders.payment_attempts']);
  });
  it('is empty when the schema is up to date, and flags a missing table', () => {
    const full = [{ table_name: 'orders', column_name: 'id' }, { table_name: 'orders', column_name: 'payment_attempts' }, { table_name: 'users', column_name: 'id' }];
    expect(missingColumns(models, full)).toEqual([]);
    expect(missingColumns(models, [{ table_name: 'orders', column_name: 'id' }, { table_name: 'orders', column_name: 'payment_attempts' }])).toEqual(['users (table)']);
  });
});
