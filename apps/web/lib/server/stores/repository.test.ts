import { storeBookContract } from './contract';
import { InMemoryStoreBookRepository } from './repository';

storeBookContract('in-memory', async () => ({ repo: new InMemoryStoreBookRepository(), household: 'household-a' }));
