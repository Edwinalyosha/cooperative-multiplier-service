import { Test, TestingModule } from '@nestjs/testing';
import { ContributionsController } from './contributions.controller';

describe('ContributionsController', () => {
  let controller: ContributionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ContributionsController],
    }).compile();

    controller = module.get<ContributionsController>(ContributionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
