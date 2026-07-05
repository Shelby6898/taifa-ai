/**
 * Validates a postal code based on specific rules.
 * 
 * @param {string} postalCode - The postal code to validate.
 * @return {boolean} True if the postal code is valid, false otherwise.
 */
function validatePostalCode(postalCode) {
    // Regular expression to match the postal code format
    const postalCodeRegex = /^[0-9]{5}$/;

    // Check if the postal code matches the regex
    return postalCodeRegex.test(postalCode);
}

// Example usage:
const validPostcode = "12345";
const invalidPostcode = "1234";

console.log(validatePostalCode(validPostcode)); // true
console.log(validatePostalCode(invalidPostcode));  // false