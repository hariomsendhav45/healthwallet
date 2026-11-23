import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'node:net';
import { MedicalDocumentScanner } from './file-scanner.interface';

@Injectable()
export class ClamAvFileScanner implements MedicalDocumentScanner {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.host = config.get<string>('CLAMAV_HOST', '127.0.0.1')!;
    this.port = Number(config.get<string>('CLAMAV_PORT', '3310'));
    this.timeoutMs = Number(config.get<string>('CLAMAV_TIMEOUT_MS', '15000'));
  }

  async scan(body: Buffer): Promise<'CLEAN'> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      let response = '';
      let settled = false;
      const failUnavailable = () => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new ServiceUnavailableException('Document security scanning is unavailable.'));
      };
      socket.setTimeout(this.timeoutMs, failUnavailable);
      socket.on('error', failUnavailable);
      socket.on('connect', () => {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(body.length);
        socket.write(Buffer.concat([Buffer.from('zINSTREAM\0'), length, body, Buffer.alloc(4)]));
      });
      socket.on('data', (chunk: Buffer) => {
        response += chunk.toString('utf8');
        if (!response.includes('\n')) return;
        settled = true;
        socket.end();
        if (/:\s*OK\s*$/.test(response.trim())) resolve('CLEAN');
        else if (/FOUND\s*$/.test(response.trim()))
          reject(new UnprocessableEntityException('This file did not pass the malware scan.'));
        else reject(new ServiceUnavailableException('Document security scanning failed.'));
      });
    });
  }
}
