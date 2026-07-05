const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

export const validateUsername = (username) => {
  return usernameRegex.test(username);
};