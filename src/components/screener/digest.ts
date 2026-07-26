import type { DigestCategory } from '../../types';

/** Display labels for the grouping chips (§5.7 digest block). */
export const CATEGORY_LABEL: Record<DigestCategory, string> = {
  junk: 'Junk',
  newsletters: 'Newsletters',
  recruiters: 'Recruiters',
  sales: 'Sales',
  support: 'Support',
  'client inquiry': 'Client inquiry',
  personal: 'Personal',
  unclear: 'Unclear',
  other: 'Other',
};
