import { Test, TestingModule } from '@nestjs/testing';
import { MultiplierService } from './multiplier.service';

describe('MultiplierService', () => {
  let service: MultiplierService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MultiplierService],
    }).compile();

    service = module.get<MultiplierService>(MultiplierService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
