import { Test, TestingModule } from '@nestjs/testing';
import { MultiplierController } from './multiplier.controller';

describe('MultiplierController', () => {
  let controller: MultiplierController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MultiplierController],
    }).compile();

    controller = module.get<MultiplierController>(MultiplierController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
