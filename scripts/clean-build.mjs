import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// 固定到本项目的生成目录，避免从其他工作目录调用时误删文件。
const buildDirectory = fileURLToPath(new URL('../.next', import.meta.url));
rmSync(buildDirectory, { recursive: true, force: true });
console.log('已清理本项目的 Next.js 编译产物，将从当前源码重新构建。');
