import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import AddFriends from '../components/Addfrnds'
import Requests from '../components/Requests'

export default function Chat({ onLogout }) {
  /* -----------------------------  STATE  ------------------------------ */
  const [friends, setFriends] = useState([])
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentUserName, setCurrentUserName] = useState('')
  const messagesEndRef = useRef(null)
  const [socket, setSocket] = useState(null)

  // refs for latest values inside socket handlers (avoid re-registering)
  const selectedFriendRef = useRef(selectedFriend)
  useEffect(() => { selectedFriendRef.current = selectedFriend }, [selectedFriend])
  const currentUserIdRef = useRef(currentUserId)
  useEffect(() => { currentUserIdRef.current = currentUserId }, [currentUserId])

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
  const SOCKET_URL = 'http://localhost:5000'

  /* --------------------------  SOCKET INIT  --------------------------- */
  useEffect(() => {
    if (!currentUserId) return
    const s = io(SOCKET_URL, { auth: { token } })

    const onConnect = () => s.emit('register', { token })
    const onReg = () => console.log('Socket registered', s.id)
    const onErr = err => console.error('Socket connect_error', err)

    s.on('connect', onConnect)
    s.on('registered', onReg)
    s.on('connect_error', onErr)
    setSocket(s)

    return () => {
      s.off('connect', onConnect)
      s.off('registered', onReg)
      s.off('connect_error', onErr)
      s.disconnect()
      setSocket(null)
    }
  }, [currentUserId])

  /* --------------------------  CURRENT USER  -------------------------- */
  useEffect(() => {
    if (!token) return
    const fetchCurrentUser = async () => {
      try {
        const res = await fetch(`${SOCKET_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return setCurrentUserName(localStorage.getItem('userName') || 'User')
        const data = await res.json()
        setCurrentUserId(data.user?._id || data.user?.id)
        setCurrentUserName(data.user?.name || localStorage.getItem('userName') || 'User')
      } catch {
        setCurrentUserName(localStorage.getItem('userName') || 'User')
      }
    }
    fetchCurrentUser()
  }, [token])

  /* ---------------------------  FRIENDS  ------------------------------ */
  const fetchFriends = async () => {
    setFriendsLoading(true)
    try {
      const res = await fetch(`${SOCKET_URL}/api/friends`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()

      let list = []
      if (Array.isArray(data)) list = data
      else if (Array.isArray(data.friends)) list = data.friends
      else if (Array.isArray(data.data)) list = data.data
      else if (Array.isArray(data.users)) list = data.users

      let statusMap = {}
      try {
        const sRes = await fetch(`${SOCKET_URL}/api/online/friends-status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const sData = await sRes.json()
        if (Array.isArray(sData.friends))
          statusMap = sData.friends.reduce((acc, f) => ({ ...acc, [String(f.id)]: !!f.online }), {})
      } catch { }

      const formatted = list.map(f => {
        const u = f.user || f.friend || f
        return {
          _id: u._id || u.id,
          name: u.name || u.username || 'Unknown',
          email: u.email,
          lastMessage: f.lastMessage || f.last_message,
          unreadCount: f.unreadCount || f.unread_count || 0,
          online: !!statusMap[String(u._id || u.id)],
        }
      })
      setFriends(formatted)
    } catch {
      setFriends([])
    } finally {
      setFriendsLoading(false)
    }
  }
  useEffect(() => { fetchFriends() }, [])

  /* --------------------------  MESSAGES  ------------------------------ */
  const fetchMessages = async friendId => {
    if (!friendId) return
    setMessagesLoading(true)
    try {
      const res = await fetch(`${SOCKET_URL}/api/messages?friendId=${friendId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      const msgs = (data.messages || data.data || data || []).map(m => ({
        _id: m._id,
        text: m.text || m.content,
        sender: m.sender || m.senderId || m.sender_id,
        receiver: m.receiver || m.receiverId || m.receiver_id || m.to,
        createdAt: m.createdAt || m.created_at || m.timestamp,
      }))
      setMessages(Array.from(new Map(msgs.map(m => [m._id, m])).values()))
    } catch {
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }
  useEffect(() => { if (selectedFriend) fetchMessages(selectedFriend._id) }, [selectedFriend])

  /* -----------------------  INCOMING SOCKET MSG  ---------------------- */
  useEffect(() => {
    if (!socket) return

    const handler = msg => {
      console.log('🔔 Received newMessage event:', msg)
      if (!msg) return
      const norm = {
        _id: msg._id || msg.id || Date.now().toString(),
        clientTempId: msg.clientTempId || msg.client_temp_id || msg.tempId,
        text: msg.text || msg.content || '',
        sender: msg.sender || msg.senderId || msg.sender_id,
        receiver: msg.receiver || msg.receiverId || msg.receiver_id || msg.to,
        createdAt: msg.createdAt || msg.created_at || msg.timestamp || new Date().toISOString(),
      }

      const me = currentUserIdRef.current ? String(currentUserIdRef.current) : null
      const sid = norm.sender ? String(norm.sender) : null
      const rid = norm.receiver ? String(norm.receiver) : null

      console.log('🔍 Checking message:', { me, sender: sid, receiver: rid, text: norm.text })

      // ✅ FILTER: Only process messages where current user is sender OR receiver
      if (!me || (String(sid) !== me && String(rid) !== me)) {
        console.log('⚠️ Ignoring message not for me:', { sender: sid, receiver: rid, me })
        return
      }

      const friendId = (sid && sid !== me) ? sid : rid
      console.log('✅ Message accepted, friendId:', friendId)

      const open = selectedFriendRef.current
      if (open && friendId && String(open._id) === String(friendId)) {
        console.log('💬 Adding to open chat with:', open.name)
        // belongs to open thread: reconcile / append
        setMessages(prev => {
          if (prev.some(m => m._id === norm._id)) {
            if (norm.clientTempId) return prev.filter(m => m._id !== norm.clientTempId)
            return prev
          }
          if (norm.clientTempId) return prev.map(m => m._id === norm.clientTempId ? { ...m, ...norm } : m)
          return [...prev, norm]
        })
      } else {
        console.log('📬 Updating friend list for:', friendId)
        // not open: mark friend with lastMessage + unread bump
        if (friendId) {
          setFriends(prev => prev.map(f => f._id && String(f._id) === String(friendId) ? { ...f, lastMessage: { text: norm.text, createdAt: norm.createdAt }, unreadCount: (f.unreadCount || 0) + 1 } : f))
        }
      }
    }

    socket.on('newMessage', handler)
    return () => socket.off('newMessage', handler)
  }, [socket])

  /* --------------------------  SCROLL  -------------------------------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* --------------------------  SEND MSG  ------------------------------ */
  const handleSendMessage = async e => {
    e.preventDefault()
    if (!newMessage.trim() || !selectedFriend) return
    setLoading(true); setError('')

    const receiverId = selectedFriend._id || selectedFriend.id
    // Guard: validate receiver exists and is not current user
    if (!receiverId || String(receiverId) === String(currentUserId)) {
      setError('Invalid recipient')
      setLoading(false)
      return
    }
    const tempId = `temp-${Date.now()}`
    const localMsg = {
      _id: tempId,
      text: newMessage,
      sender: currentUserId,
      receiver: selectedFriend._id,
      createdAt: new Date().toISOString(),
    }
    setMessages(prev => (prev.some(m => m._id === localMsg._id) ? prev : [...prev, localMsg]))

    /* Send via Socket.IO only (handles both DB + real-time emit) */
    if (socket?.connected) {
      socket.emit('sendMessage', { to: String(receiverId), text: newMessage, clientTempId: tempId }, ack => {
        if (ack?.ok && ack.data) {
          setMessages(prev => {
            if (prev.some(m => m._id === ack.data._id)) return prev.filter(m => m._id !== tempId)
            return prev.map(m => m._id === tempId ? { ...m, _id: ack.data._id, createdAt: ack.data.createdAt } : m)
          })
        } else {
          setError(ack?.message || 'Failed to send')
        }
      })
    } else {
      setError('Not connected to server')
    }
    setNewMessage('')
    setLoading(false)
  }

  /* --------------------------  LOGOUT  -------------------------------- */
  const handleLogout = async () => {
    try {
      await fetch(`${SOCKET_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch { }
    socket?.disconnect()
    onLogout()
  }

  /* --------------------------  HELPERS  ------------------------------- */
  const formatTime = ts => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
  const formatDate = ts => {
    if (!ts) return ''
    const d = new Date(ts), t = new Date(), y = new Date(t)
    y.setDate(y.getDate() - 1)
    if (d.toDateString() === t.toDateString()) return 'Today'
    if (d.toDateString() === y.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
  const groupMessagesByDate = () => {
    const groups = []
    let curr = null
    messages.forEach(m => {
      const date = formatDate(m.createdAt)
      if (date !== curr) { groups.push({ date, messages: [] }); curr = date }
      groups[groups.length - 1].messages.push(m)
    })
    return groups
  }

  /* ---------------------------  RENDER  ------------------------------- */
  return (
    <div className="flex h-screen w-screen bg-gray-100 overflow-hidden">
      {/* ------------ Sidebar ------------ */}
      <div className="w-80 flex flex-col border-r bg-white shadow-lg">
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
          <div className="p-4 border-b border-indigo-500 flex items-center space-x-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg">
              {currentUserName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{currentUserName}</h3>
              <div className="flex items-center space-x-1.5">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                <span className="text-xs text-green-200">Online</span>
              </div>
            </div>
          </div>
          <div className="px-4 py-3">
            <h2 className="text-xl font-bold">Chats</h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {friendsLoading ? (
            <div className="p-4 text-center text-gray-500">Loading friends...</div>
          ) : friends.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">No friends yet. Add some!</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {friends.map(f => (
                <div
                  key={f._id}
                  onClick={() => setSelectedFriend(f)}
                  className={`p-4 cursor-pointer transition-all ${selectedFriend?._id === f._id
                    ? 'bg-indigo-50 border-l-4 border-indigo-600'
                    : 'hover:bg-gray-50 border-l-4 border-transparent'}`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 relative">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-bold text-lg">
                        {f.name.charAt(0).toUpperCase()}
                      </div>
                      <div
                        className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white"
                        style={{ backgroundColor: f.online ? '#22c55e' : '#9ca3af' }}
                        title={f.online ? 'Online' : 'Offline'}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold text-gray-900 truncate">{f.name}</h4>
                        <span className={`text-xs font-medium ${f.online ? 'text-green-600' : 'text-gray-400'}`}>
                          {f.online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      {f.lastMessage && (
                        <p className="text-sm text-gray-500 truncate">{f.lastMessage.text}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-gray-50">
          <button
            onClick={handleLogout}
            className="w-full bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white px-4 py-2.5 rounded-md transition-all text-sm font-medium shadow-md hover:shadow-lg"
          >
            Logout
          </button>
        </div>
      </div>

      {/* ------------ Chat Area ------------ */}
      <div className="flex-1 flex flex-col">
        {selectedFriend ? (
          <>
            <div className="px-6 py-4 bg-white border-b shadow-sm">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-bold">
                  {selectedFriend.name.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="font-semibold text-lg text-gray-900">{selectedFriend.name}</h2>
                  <p className="text-xs text-gray-500">{selectedFriend.email}</p>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-gradient-to-b from-gray-50 to-gray-100 p-6">
              {messagesLoading ? (
                <div className="flex items-center justify-center h-full text-gray-500">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="text-6xl mb-4">💬</div>
                    <p className="text-gray-500">No messages yet</p>
                    <p className="text-sm text-gray-400 mt-1">Start the conversation!</p>
                  </div>
                </div>
              ) : (
                groupMessagesByDate().map((g, i) => (
                  <div key={g.date || i} className="mb-6">
                    <div className="flex justify-center my-4">
                      <span className="bg-white shadow-sm text-gray-600 px-4 py-1.5 rounded-full text-xs font-medium">
                        {g.date}
                      </span>
                    </div>
                    {g.messages.map(msg => {
                      const isMe = String(msg.sender) === String(currentUserId)
                      return (
                        <div key={msg._id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-3`}>
                          <div className="flex flex-col max-w-md">
                            <div
                              className={`${isMe
                                ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl'
                                : 'bg-white text-gray-800 shadow-md border border-gray-200 rounded-tl-2xl rounded-tr-2xl rounded-br-2xl'
                                } px-4 py-3`}
                            >
                              <p className="break-words">{msg.text}</p>
                            </div>
                            <div className={`text-xs text-gray-500 mt-1 px-2 ${isMe ? 'text-right' : 'text-left'}`}>
                              {formatTime(msg.createdAt)}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="px-6 py-4 bg-white border-t">
              <div className="flex items-center space-x-3">
                <input
                  type="text"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <button
                  type="submit"
                  disabled={loading || !newMessage.trim()}
                  className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white px-6 py-3 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                >
                  {loading ? 'Sending...' : 'Send'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <div className="text-center">
              <div className="text-8xl mb-4">💬</div>
              <h3 className="text-2xl font-semibold text-gray-700 mb-2">Welcome to Chat</h3>
              <p className="text-gray-500">Select a friend from the sidebar to start chatting</p>
            </div>
          </div>
        )}
      </div>

      {/* ------------ Add Friends Panel ------------ */}
      <div className="w-96 flex flex-col border-l bg-white shadow-lg">
        <div className="p-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
          <h2 className="text-xl font-bold">Add Friends</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Requests socket={socket} onFriendAdded={fetchFriends} />
          <AddFriends socket={socket} onFriendAdded={fetchFriends} />
        </div>
      </div>
    </div>
  )
}