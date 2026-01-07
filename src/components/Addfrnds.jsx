import { useState, useEffect } from 'react'

export default function AddFriends({ onFriendAdded, socket }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [incomingRequests, setIncomingRequests] = useState([])
  const [justAccepted, setJustAccepted] = useState(new Set()) // Track recently accepted users

  const token = localStorage.getItem('token')

  // Check if query is a MongoDB ObjectId (24 hex characters)
  const isValidObjectId = (str) => /^[0-9a-fA-F]{24}$/.test(str)

  // Remove accepted users from results when notified via window event
  useEffect(() => {
    const handler = (e) => {
      const id = e?.detail?.from || e?.detail?.id
      const name = e?.detail?.name || ''
      if (!id) return
      // If the accepted user is in current search results, mark as friend
      setResults(prev => prev.map(u => (String(u._id) === String(id) ? { ...u, isFriend: true, isRequested: false } : u)))
      // (removed temporary success message)
    }
    window.addEventListener('friendAccepted', handler)
    return () => window.removeEventListener('friendAccepted', handler)
  }, [])

  // Fetch current incoming requests so search results can show "Accept"
  useEffect(() => {
    const fetchRequests = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/friends/requests', {
          headers: { Authorization: `Bearer ${token}` }
        })
        if (!res.ok) return
        const data = await res.json()
        const ids = (data.requests || []).map(r => String(r.id))
        setIncomingRequests(ids)
      } catch (err) {
        // ignore
      }
    }
    fetchRequests()
  }, [])

  // Also listen to socket events directly (for the requester)
  useEffect(() => {
    if (!socket) return
    console.log('AddFriends: socket ready', socket.id, socket.connected)
    const onAccepted = (payload) => {
      console.log('AddFriends: received friendAccepted', payload)
      const id = payload?.from
      const name = payload?.name || ''
      if (!id) return
      setResults(prev => prev.map(u => (String(u._id) === String(id) ? { ...u, isFriend: true, isRequested: false } : u)))
      // (removed temporary success message)
    }
    const onRejected = (payload) => {
      console.log('AddFriends: received friendRejected', payload)
      const id = payload?.from
      if (!id) return
      setResults(prev => prev.map(u => (String(u._id) === String(id) ? { ...u, isRequested: false } : u)))
      // remove from incomingRequests if present (the accepter rejected us)
      setIncomingRequests(prev => prev.filter(i => i !== String(id)))
    }
    socket.on('friendAccepted', onAccepted)
    socket.on('friendRejected', onRejected)
    const onFriendsUpdated = () => {
      console.log('AddFriends: received friendsUpdated')
      // trigger parent to refresh friends list and update this UI
      if (onFriendAdded) onFriendAdded()
      // also mark matching entries as friends
      setResults(prev => prev.map(u => ({ ...u, isFriend: u.isFriend || false })))
    }
    socket.on('friendsUpdated', onFriendsUpdated)
    // When someone sends you a request, add to incomingRequests so UI shows Accept
    const onFriendRequest = (payload) => {
      console.log('AddFriends: received friendRequest', payload)
      const from = payload?.from
      if (!from) return
      setIncomingRequests(prev => Array.from(new Set([...prev, String(from)])))
    }
    socket.on('friendRequest', onFriendRequest)
    return () => {
      socket.off('friendAccepted', onAccepted)
      socket.off('friendRejected', onRejected)
      socket.off('friendsUpdated', onFriendsUpdated)
      socket.off('friendRequest', onFriendRequest)
    }
  }, [socket])

  // Search users
  const handleSearch = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResults([])
    setSuccessMessage('')

    try {
      // If query looks like an ID, search by ID
      if (isValidObjectId(query.trim())) {
        const res = await fetch(`http://localhost:5000/api/friends/user/${query.trim()}`, {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
        })

        const data = await res.json()

        if (!res.ok) {
          setError(data.message || 'User not found')
          setResults([])
        } else {
          // Add isFriend property to the user object
          setResults([{
            _id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            isFriend: data.user.isFriend,
            online: data.user.online
          }])
        }
      } else {
        // Search by name or email
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
          // Use status flags returned by the server (isFriend, isRequested, incoming)
          const usersWithStatus = (data.users || []).map(user => ({
            _id: user.id || user._id,
            name: user.name,
            email: user.email,
            isFriend: !!user.isFriend,
            isRequested: !!user.isRequested,
            incoming: !!user.incoming,
            online: !!user.online,
          }))
          setResults(usersWithStatus)
        }
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
      // Ensure our socket is connected to avoid race where server has no socket mapping yet
      if (!socket || !socket.connected) {
        setError('Socket not connected yet. Please wait a moment and try again.')
        setLoading(false)
        return
      }
      const res = await fetch('http://localhost:5000/api/friends/add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendId }),
      })

      // Defensive: try to parse JSON but capture non-JSON responses for debugging
      let data = null
      const text = await res.text()
      try { data = text ? JSON.parse(text) : {} } catch (e) { console.error('Non-JSON response from /api/friends/add:', text) }

      if (!res.ok) {
        console.error('Add friend failed', res.status, data)
        setError((data && data.message) || `Failed to add friend (status ${res.status})`)
      } else {
        const msg = data.message || ''
        setSuccessMessage(msg)

        // If server auto-accepted (mutual request), refresh friends list
        if (msg.toLowerCase().includes('accepted')) {
          if (onFriendAdded) onFriendAdded()
          // remove from search results
          setResults(results.filter(user => user._id !== friendId))
        } else {
          // Mark as request sent in the UI
          setResults(results.map(u => u._id === friendId ? { ...u, isRequested: true } : u))
        }
      }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  // Accept incoming friend request (from search results)
  const handleAccept = async (requesterId) => {
    setLoading(true)
    try {
      const res = await fetch('http://localhost:5000/api/friends/requests/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requesterId, action: 'accept' })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || 'Failed to accept')
      } else {
        // mark as friend in results and remove incoming flag
        setResults(prev => prev.map(u => (String(u._id) === String(requesterId) ? { ...u, isFriend: true, isRequested: false } : u)))
        setIncomingRequests(prev => prev.filter(id => id !== String(requesterId)))
        // Mark as just accepted for temporary "Accepted" display
        setJustAccepted(prev => new Set(prev).add(String(requesterId)))
        setTimeout(() => {
          setJustAccepted(prev => {
            const next = new Set(prev)
            next.delete(String(requesterId))
            return next
          })
        }, 3000)
        if (onFriendAdded) onFriendAdded()
        setSuccessMessage('Friend request accepted')
        setTimeout(() => setSuccessMessage(''), 3000)
      }
    } catch (err) {
      setError(err.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-full mx-auto bg-white p-4 rounded-lg">

      <form onSubmit={handleSearch} className="flex mb-3">
        <input
          type="text"
          placeholder="Search by ID, name, or email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 px-3 py-2 border rounded-l-md focus:outline-none focus:ring-2 focus:ring-indigo-400 text-sm"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-indigo-600 text-white px-4 py-2 rounded-r-md hover:bg-indigo-700 disabled:opacity-70 text-sm font-medium"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {error && <p className="text-xs text-red-600 mb-2 bg-red-50 p-2 rounded">{error}</p>}
      {successMessage && <p className="text-xs text-green-600 mb-2 bg-green-50 p-2 rounded">{successMessage}</p>}

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {results.map((user) => (
          <div
            key={user._id}
            className="flex justify-between items-center p-3 border rounded-md bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{user.name}</p>
                  <p className="text-xs text-gray-500 truncate">{user.email}</p>
                  {user.online && <span className="text-xs text-green-600">● Online</span>}
                </div>
              </div>
            </div>
            <div className="ml-2 flex-shrink-0">
              {justAccepted.has(String(user._id)) ? (
                <span className="bg-green-500 text-white px-3 py-1.5 rounded-md text-xs font-medium animate-pulse">
                  ✓ Accepted
                </span>
              ) : user.isFriend ? (
                <span className="bg-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-xs font-medium cursor-not-allowed">
                  Already Friends
                </span>
              ) : (
                // If someone has sent *you* a request, show Accept button
                incomingRequests.includes(String(user._id)) ? (
                  <button
                    onClick={() => handleAccept(user._id)}
                    disabled={loading}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-70 text-xs font-medium transition-colors"
                  >
                    Accept
                  </button>
                ) : (
                  user.isRequested ? (
                    <span className="bg-yellow-100 text-yellow-800 px-3 py-1.5 rounded-md text-xs font-medium">Request Sent</span>
                  ) : (
                    <button
                      onClick={() => handleAddFriend(user._id)}
                      disabled={loading}
                      className="bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-700 disabled:opacity-70 text-xs font-medium transition-colors"
                    >
                      Add Friend
                    </button>
                  )
                )
              )}
            </div>
          </div>
        ))}
      </div>

      {results.length === 0 && query && !loading && (
        <p className="text-xs text-gray-500 mt-2 text-center p-3 bg-gray-50 rounded">
          No users found. Try searching by name, email, or user ID.
        </p>
      )}

      {!query && (
        <p className="text-xs text-gray-400 mt-2 text-center p-3">

        </p>
      )}
    </div>
  )
}
