import { InMemoryStoreBookRepository } from './repository';
import { InMemoryStoreLocationRepository } from './locations';
import { storeLocationContract } from './location-contract';

storeLocationContract('in-memory', async () => {
  const book = new InMemoryStoreBookRepository();
  const household = 'household-a';
  const locs = new InMemoryStoreLocationRepository(async (h, id) => (await book.book(h)).stores.some((s) => s.id === id));
  return { locs, book, household };
});
