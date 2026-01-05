import { useState } from 'react'
import './App.css'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Chat from './pages/Chat'

function App() {
  const [page, setPage] = useState('login')

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('userId')
    localStorage.removeItem('userName')
    setPage('login')
  }

  return (
    <div className="h-screen w-full bg-gray-300 flex items-center justify-center overflow-hidden">
      {page === 'login' && (
        <Login
          onSwitch={() => setPage('signup')}
          onAuthSuccess={() => setPage('chat')}
        />
      )}

      {page === 'signup' && (
        <Signup
          onSwitch={() => setPage('login')}
          onAuthSuccess={() => setPage('chat')}
        />
      )}

      {page === 'chat' && (
        <Chat onLogout={handleLogout} />
        // AddFriends will now be part of the Chat page itself
      )}
    </div>
  )
}

export default App
