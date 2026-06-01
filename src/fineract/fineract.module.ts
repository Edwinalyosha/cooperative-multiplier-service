import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FineractService } from './fineract.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30_000,
      maxRedirects: 3,
    }),
  ],
  providers: [FineractService],
  exports: [FineractService],
})
export class FineractModule {}
