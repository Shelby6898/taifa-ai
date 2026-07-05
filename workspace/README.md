# Simple Auth Server

## Description

This is a simple authentication server built using Express.js with JWT tokens for user authentication and management. It includes routes for user registration, login, and token generation.

## Project Files

- `backend/controllers/authController.js`: Handles user authentication, including login and token generation.
  - Imports: `jsonwebtoken` [external]
  - Schema: `userSchema` in `backend/models/User.js`
  
- `backend/models/User.js`: Defines the structure of a user with fields like `email`, `password`, and `role`.
  
- `backend/routes/userRoutes.js`: Handles HTTP requests for creating users and authenticating users.
  
- `frontend/src/pages/Login.jsx`: A component for logging in users, using the `/login` route to send credentials.
  
- `frontend/src/pages/Register.jsx`: A component for registering new users, using the `/register` route to send user details.

## Dependencies

No external dependencies found in the files shown.