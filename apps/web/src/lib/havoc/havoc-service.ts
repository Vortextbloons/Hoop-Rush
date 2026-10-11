import { HavocServiceError, type HavocService } from './havoc-service-contract.ts';

let activeService: HavocService | null = null;

export function setHavocService(service: HavocService | null): void {
  activeService = service;
}

export function getHavocService(): HavocService {
  if (activeService === null) {
    throw new HavocServiceError('internal', 'havoc service has not been wired yet');
  }
  return activeService;
}
