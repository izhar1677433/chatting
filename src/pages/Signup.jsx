import { useState } from 'react'
import { API_URL } from '../config'

export default function Signup({ onSwitch, onAuthSuccess }) {
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)
        setLoading(true)
        try {
            const res = await fetch(`${API_URL}/api/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password }),
            })
            const data = await res.json()
            if (!res.ok) {
                setError(data.message || 'Signup failed')
            } else {
                // Don't auto-save tokens here; send user to the login page
                setName('')
                setEmail('')
                setPassword('')
                if (onAuthSuccess) onAuthSuccess()
            }
        } catch (err) {
            setError(err.message || 'Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow">
            <h2 className="text-2xl font-semibold mb-6 text-center">Create account</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-sm font-medium mb-1">Name</label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                </div>

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

                <button disabled={loading} className="w-full bg-indigo-600 text-white py-2 rounded-md hover:bg-indigo-700 disabled:opacity-70">{loading ? 'Creating...' : 'Create account'}</button>
            </form>

            {error && <p className="text-sm text-red-600 mt-3 text-center">{error}</p>}

            <p className="text-sm text-center mt-4">
                Already have an account?{' '}
                <button onClick={onSwitch} className="text-indigo-600 hover:underline">
                    Sign in
                </button>
            </p>
        </div>
    )
}
