import * as https from 'https';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

export function requestJson(url: string, options: RequestOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: options.method || 'GET',
        headers: options.headers || {}
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          const status = res.statusCode || 0;
          if (status < 200 || status >= 300) {
            reject(new Error(`HTTP ${status}: ${raw.slice(0, 200)}`));
            return;
          }
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch {
            reject(new Error(`响应不是 JSON: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.setTimeout(options.timeout || 20000, () => {
      req.destroy(new Error('请求超时'));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}
