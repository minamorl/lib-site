import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// When a second locale is added, also register the `i18n` collection here
// (i18nLoader / i18nSchema from the same packages) and create src/content/i18n/.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
