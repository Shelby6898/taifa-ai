import { useState } from "react";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleLogin = async () => {
    // sends email/password to backend auth endpoint
  };

  return <div>Login form goes here</div>;
}

export default Login;
