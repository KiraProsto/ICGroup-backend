import { Injectable } from '@nestjs/common';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
// Captured once at module load — avoids repeated resolution on each request.
const { version } = require('../package.json') as { version: string };

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'ICGroup API',
      version,
      status: 'ok',
    };
  }
}
