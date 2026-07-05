const isPhoneNumberValid = (phoneNumber) => {
  // Check if the input is a string and not empty
  if (typeof phoneNumber !== 'string' || phoneNumber.trim() === '') {
    return false;
  }

  // Regex pattern to validate phone numbers in various formats
  const phoneRegex = /^(\+?\d{1,3}[-. ])?((\(\d{1,3}\))|\d{3})[-. ]?\d{3}[-. ]?\d{4}$/;

  return phoneRegex.test(phoneNumber);
};

export default isPhoneNumberValid;