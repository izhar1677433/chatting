import { useState, useEffect } from 'react'

export default function Requests({ socket, onFriendAdded }) {
    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const token = localStorage.getItem('token')

    const fetchRequests = async () => {
        try {
            setLoading(true)
            const res = await fetch('http://localhost:5000/api/friends/requests', {
                headers: { Authorization: `Bearer ${token}` },
            })
            const data = await res.json()
            if (res.ok) {
                // dedupe by id
                const list = (data.requests || []).reduce((acc, r) => {
                    if (!acc.some(x => String(x.id) === String(r.id))) acc.push(r)
                    return acc
                }, [])
                setRequests(list)
            }
            else setError(data.message || 'Failed to load requests')
        } catch (err) {
            setError(err.message || 'Network error')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchRequests()
    }, [])

    useEffect(() => {
        if (!socket) return
        const handler = (payload) => {
            console.log('Requests: received friendRequest', payload)
            // payload: { from, name, email }
            setRequests(prev => {
                const id = String(payload.from)
                if (prev.some(r => String(r.id) === id)) return prev
                return [{ id, name: payload.name, email: payload.email }, ...prev]
            })
        }
        socket.on('friendRequest', handler)
        // If a request is accepted (possibly from another session), remove it from list
        const onAccepted = (payload) => {
            console.log('Requests: received friendAccepted', payload)
            const id = payload?.from
            if (!id) return
            setRequests(prev => prev.filter(r => String(r.id) !== String(id)))
        }
        // If a request is rejected, also remove it from list
        const onRejected = (payload) => {
            console.log('Requests: received friendRejected', payload)
            const id = payload?.from
            if (!id) return
            setRequests(prev => prev.filter(r => String(r.id) !== String(id)))
        }
        // Generic friendsUpdated -> refresh requests from server
        const onFriendsUpdated = () => {
            console.log('Requests: received friendsUpdated')
            fetchRequests()
        }
        socket.on('friendAccepted', onAccepted)
        socket.on('friendRejected', onRejected)
        socket.on('friendsUpdated', onFriendsUpdated)
        return () => {
            socket.off('friendRequest', handler)
            socket.off('friendAccepted', onAccepted)
            socket.off('friendRejected', onRejected)
            socket.off('friendsUpdated', onFriendsUpdated)
        }
    }, [socket])

    const respond = async (requesterId, action) => {
        try {
            setLoading(true)
            const res = await fetch('http://localhost:5000/api/friends/requests/respond', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ requesterId: String(requesterId), action }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                console.warn('respond failed', res.status, data)
                setError(data.message || 'Failed')
            } else {
                // get requester name from current list
                const reqObj = requests.find(r => String(r.id) === String(requesterId))
                const requesterName = reqObj ? reqObj.name : (data && data.name) || undefined

                // remove from list
                setRequests(prev => prev.filter(r => String(r.id) !== String(requesterId)))
                if (action === 'accept' && onFriendAdded) onFriendAdded()
                // Notify other local components (AddFriends) to update in real-time
                try {
                    const payload = { from: requesterId, name: requesterName }
                    window.dispatchEvent(new CustomEvent('friendAccepted', { detail: payload }))
                } catch (e) {
                    // ignore
                }
            }
        } catch (err) {
            setError(err.message || 'Network error')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="p-4 border-b border-gray-200 shaodow-lg">
            <h3 className="text-sm font-semibold mb-2">Requests</h3>
            {loading && <div className="text-xs text-gray-500">Loading...</div>}
            {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
            {requests.length === 0 ? (
                <div className="text-xs text-gray-500">No requests</div>
            ) : (
                <div className="space-y-2">
                    {requests.map(r => (
                        <div key={r.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                            <div>
                                <div className="font-medium text-sm">{r.name}</div>
                                <div className="text-xs text-gray-500">{r.email}</div>
                            </div>
                            <div className="flex space-x-2">
                                <button onClick={() => respond(r.id, 'accept')} className="text-xs bg-green-600 text-white px-2 py-1 rounded">Accept</button>
                                <button onClick={() => respond(r.id, 'reject')} className="text-xs bg-gray-200 px-2 py-1 rounded">Reject</button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
