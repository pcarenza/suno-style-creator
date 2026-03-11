import { StrictMode } from 'react' // importing StrictMode from React to enable additional checks and warnings for its descendants in development mode.
import { createRoot } from 'react-dom/client' // importing createRoot from react-dom/client to create a root for rendering the React application. This is part of the new React 18 API for concurrent rendering.
import './index.css' // importing the CSS file for styling the application. This will apply the styles defined in index.css to the entire application.
import App from './App.jsx' // importing the main App component from the App.jsx file. This component will serve as the root component of the application, containing all other components and logic.

createRoot(document.getElementById('root')).render( // creating a root for the React application by selecting the DOM element with the id 'root' and calling the render method to render the application.
  <StrictMode>
    <App />
  </StrictMode>,
)
