// Separate read-only design preview; no native bridge, stores or execution.
import {makeServer} from './preview.mjs';
const port = Number(process.env.DOCTOR_VOXEL_PORT || 8766);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 8765) throw new Error('Use a distinct preview port from 1024 to 65535.');
const server = makeServer({previewTheme:'voxel'});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Doctor voxel design preview: http://127.0.0.1:${port}/tutorial (read-only, Ctrl+C to stop)`));
