import { useState } from 'react'

export default function Login({ onSwitch, onAuthSuccess }) {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)
        setLoading(true)

        try {
            const res = await fetch('http://localhost:5000/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            })

            const data = await res.json()

            if (!res.ok) {
                // Handle server errors
                setError(data.message || 'Login failed')
            } else {
                // Save token and user info
                if (data.token) localStorage.setItem('token', data.token)
                if (data.user) {
                    if (data.user.id) localStorage.setItem('userId', data.user.id)
                    if (data.user.name) localStorage.setItem('userName', data.user.name)
                }

                // Clear form
                setEmail('')
                setPassword('')

                // Notify parent that login succeeded
                if (onAuthSuccess) onAuthSuccess()
            }
        } catch (err) {
            // Handle network errors
            setError(err.message || 'Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow">
            <h2 className="text-2xl font-semibold mb-6 text-center">Sign in</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-1">Password</label>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 disabled:opacity-70"
                >
                    {loading ? 'Signing in...' : 'Sign in'}
                </button>
            </form>

            {error && <p className="text-sm text-red-600 mt-3 text-center">{error}</p>}

            <p className="text-sm text-center mt-4">
                Don't have an account?{' '}
                <button onClick={onSwitch} className="text-indigo-600 hover:underline">
                    Sign up
                </button>
            </p>
        </div>
    )
}
