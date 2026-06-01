import { Test, TestingModule } from '@nestjs/testing';
import { FineractService } from './fineract.service';

describe('FineractService', () => {
  let service: FineractService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FineractService],
    }).compile();

    service = module.get<FineractService>(FineractService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
