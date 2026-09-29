import { startServer } from './http';
const { port } = await startServer({
  root: process.cwd(),
  port: Number(process.env.PORT || 5173),
  dev: !process.argv.includes('--production'),
});
console.log(`Travopaz 已启动：http://localhost:${port}`);
