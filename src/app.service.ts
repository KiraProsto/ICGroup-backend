import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

// Captured once at module load — avoids repeated resolution on each request.
// Uses process.cwd() instead of import.meta.url for CJS test-runner compatibility.
const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
  version: string;
};

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
