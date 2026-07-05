// frontend/src/utils/creditCardValidator.js

export function isValidCreditCard(cardNumber) {
  // Regular expression to match valid credit card numbers
  const regex = /^\d{13,16}$/;
  
  // Check if the card number matches the regular expression
  return regex.test(cardNumber);
}