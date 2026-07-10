const express = require('express');
const userRoutes = require('./routes/userRoutes');

const app = express();
const PORT = 4001;

app.use(express.json());
app.use('/api/users', userRoutes);

app.listen(PORT, () => {
  console.log(`Workspace backend running on port ${PORT}`);
});
