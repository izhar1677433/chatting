import { useState } from 'react'

export default function AddFriends() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState('')

  const token = localStorage.getItem('token')

  // Search users
  const handleSearch = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResults([])
    setSuccessMessage('')

    try {
      const res = await fetch('http://localhost:5000/api/friends/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.message || 'Search failed')
      } else {
        setResults(data.users || [])
      }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  // Send friend request
  const handleAddFriend = async (friendId) => {
    setLoading(true)
    setError(null)
    setSuccessMessage('')

    try {
      const res = await fetch('http://localhost:5000/api/friends/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendId }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.message || 'Failed to add friend')
      } else {
        setSuccessMessage(data.message || 'Friend request sent!')
        // Optionally remove the added friend from search results
        setResults(results.filter((user) => user._id !== friendId))
      }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-full mx-auto bg-white p-6 rounded-lg shadow mt-6">
      <h2 className="text-2xl font-semibold mb-4 text-center">Add Friends</h2>

      <form onSubmit={handleSearch} className="flex mb-4">
        <input
          type="text"
          placeholder="Search by name or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 px-4 py-2 border rounded-l-md focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded-r-md hover:bg-indigo-700 disabled:opacity-70"
        >
          Search
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {successMessage && <p className="text-sm text-green-600 mb-3">{successMessage}</p>}

      <ul className="space-y-2">
        {results.map((user) => (
          <li
            key={user._id}
            className="flex justify-between items-center p-2 border rounded-md"
          >
            <span>{user.name} ({user.email})</span>
            <button
              onClick={() => handleAddFriend(user._id)}
              disabled={loading}
              className="bg-green-600 text-white px-3 py-1 rounded-md hover:bg-green-700 disabled:opacity-70"
            >
              Add
            </button>
          </li>
        ))}
      </ul>

      {results.length === 0 && query && !loading && (
        <p className="text-sm text-gray-500 mt-2 text-center">No users found.</p>
      )}
    </div>
  )
}
