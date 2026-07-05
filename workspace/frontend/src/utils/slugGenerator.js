/**
 * Generate a unique slug for a given string
 *
 * @param {string} title - The original title to be converted into a slug
 * @returns {string} The generated slug
 */
function generateSlug(title) {
  // Convert spaces to hyphens
  let slug = title.replace(/\s+/g, '-');

  // Remove non-alphanumeric characters and convert to lowercase
  slug = slug.replace(/[^a-z0-9]/gi, '');

  // Ensure the slug is not empty
  if (slug === '') return 'default';

  // Optionally, add a number suffix if there are duplicate slugs
  let count = 1;
  while (document.querySelector(`#page-${slug}`)) {
    slug += `-${count}`;
    count++;
  }

  return slug;
}