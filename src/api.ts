import { hostApi } from './runtime/hostApi';
import { deviceApi } from './runtime/deviceApi';

export { BookConflictError } from './runtime/hostRequest';

export const api = import.meta.env.MODE === 'site' ? deviceApi : hostApi;
