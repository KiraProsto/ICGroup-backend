import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'ICGroup API',
      version: '1.0.0',
      status: 'ok',
    };
  }
}
