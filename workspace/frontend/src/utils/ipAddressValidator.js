const isIP = (ip) => {
  return ip.match(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/);
};

export default isIP;