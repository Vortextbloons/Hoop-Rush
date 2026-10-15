import type { SettingsChoice } from './types';
export const knowledgeField: SettingsChoice = {
  key: 'variant',
  label: 'Knowledge setting',
  options: [
    { value: 'ratings', label: 'Ratings', description: 'See player ratings' },
    { value: 'ball-knowledge', label: 'Ball Knowledge', description: 'Draft from memory' },
  ],
};
