const allowedFileExtensions = ['jpg', 'jpeg', 'png', 'gif'];

function validateFileExtension(fileName) {
  const fileNameLowerCase = fileName.toLowerCase();
  return allowedFileExtensions.includes(fileNameLowerCase);
}