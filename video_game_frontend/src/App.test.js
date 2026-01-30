import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders game title", () => {
  render(<App />);
  const title = screen.getByText(/Neon Orb Clicker/i);
  expect(title).toBeInTheDocument();
});
