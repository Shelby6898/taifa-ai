/**
 * Generate a URL-friendly slug for a given string.
 *
 * @param {string} title - The original title to be converted into a slug
 * @returns {string} The generated slug
 */
export function generateSlug(title) {
  let slug = title.replace(/\s+/g, '-');
  slug = slug.replace(/[^a-z0-9-]/gi, '').toLowerCase();

  if (slug === '') return 'default';

  return slug;
}
