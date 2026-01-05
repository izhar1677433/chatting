import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'

export default function Chat({ onLogout }) {
  const [friends, setFriends] = useState([])
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [currentUserId, setCurrentUserId] = useState(null)
  const messagesEndRef = useRef(null)
  const [socket, setSocket] = useState(null)

  const token = localStorage.getItem('token')
  const SOCKET_URL = "http://localhost:5000"

  // Fetch current user ID
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/users/me', {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await res.json()
        if (res.ok) setCurrentUserId(data.user._id)
      } catch (err) {
        console.error(err)
      }
    }
    fetchCurrentUser()
  }, [token])

  // Initialize Socket.IO
  useEffect(() => {
    if (!currentUserId) return
    const s = io(SOCKET_URL, { auth: { token } })
    setSocket(s)

    s.on('connect', () => console.log('Socket connected'))
    s.on('disconnect', () => console.log('Socket disconnected'))

    // Listen for incoming messages
    s.on('newMessage', (msg) => {
      if (!msg) return

      // Normalize message
      const normalizedMsg = {
        _id: msg._id || Date.now().toString(),
        text: msg.text || msg.content || '',
        sender: msg.sender || msg.senderId || msg.sender_id,
        receiver: msg.receiver || msg.receiverId || msg.receiver_id || msg.to,
        createdAt: msg.createdAt || msg.created_at || msg.timestamp || new Date().toISOString(),
      }

      // Only add if the message is from/to the selected friend
      if (!selectedFriend) return
      const friendId = selectedFriend._id
      if (normalizedMsg.sender === friendId || normalizedMsg.receiver === friendId) {
        setMessages(prev => [...prev, normalizedMsg])
      }
    })

    return () => s.disconnect()
  }, [selectedFriend, token, currentUserId])

  // Fetch friends
  const fetchFriends = async () => {
    try {
      setFriendsLoading(true)
      const res = await fetch('http://localhost:5000/api/friends', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()

      if (res.ok) {
        let friendsList = []
        if (Array.isArray(data)) friendsList = data
        else if (data.friends && Array.isArray(data.friends)) friendsList = data.friends
        else if (data.data && Array.isArray(data.data)) friendsList = data.data
        else if (data.users && Array.isArray(data.users)) friendsList = data.users

        const formattedFriends = friendsList.map(friend => {
          const friendUser = friend.user || friend.friend || friend
          return {
            _id: friendUser._id,
            name: friendUser.name || friendUser.username || 'Unknown User',
            email: friendUser.email,
            lastMessage: friend.lastMessage || friend.last_message,
            unreadCount: friend.unreadCount || friend.unread_count || 0,
          }
        })
        setFriends(formattedFriends)
      } else {
        setFriends([])
      }
    } catch (err) {
      setFriends([])
    } finally {
      setFriendsLoading(false)
    }
  }

  useEffect(() => { fetchFriends() }, [])

  // Fetch messages for selected friend
  const fetchMessages = async (friendId) => {
    if (!friendId) return
    try {
      setMessagesLoading(true)
      const res = await fetch(`http://localhost:5000/api/messages?friendId=${friendId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      if (res.ok) {
        const msgs = (data.messages || data.data || data || []).map(msg => ({
          _id: msg._id,
          text: msg.text || msg.content,
          sender: msg.sender || msg.senderId || msg.sender_id,
          receiver: msg.receiver || msg.receiverId || msg.receiver_id || msg.to,
          createdAt: msg.createdAt || msg.created_at || msg.timestamp,
        }))
        setMessages(msgs)
      } else setMessages([])
    } catch (err) {
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }

  useEffect(() => {
    if (selectedFriend) fetchMessages(selectedFriend._id)
  }, [selectedFriend])

  // Auto-scroll
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Send message
  const handleSendMessage = async (e) => {
    e.preventDefault()
    if (!newMessage.trim() || !selectedFriend) return
    setLoading(true)
    setError(null)

    try {
      const res = await fetch("http://localhost:5000/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: newMessage, receiver: selectedFriend._id }),
      })
      const data = await res.json()

      if (res.ok) {
        const msgObj = {
          _id: data.data?._id || Date.now().toString(),
          text: newMessage,
          sender: currentUserId,
          receiver: selectedFriend._id,
          createdAt: new Date().toISOString(),
        }
        setMessages(prev => [...prev, msgObj])
        setNewMessage("")
        if (socket) socket.emit('sendMessage', msgObj)
      } else setError(data.message || 'Failed to send message')
    } catch (err) { setError('Network error') }
    finally { setLoading(false) }
  }

  const formatTime = ts => ts ? new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit'}) : ''
  const formatDate = ts => {
    if (!ts) return ''
    const date = new Date(ts)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.toDateString() === today.toDateString()) return 'Today'
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
    return date.toLocaleDateString([], { month:'short', day:'numeric' })
  }
  const groupMessagesByDate = () => {
    const groups = []
    let currentDate = null
    messages.forEach(msg => {
      const date = formatDate(msg.createdAt)
      if (date !== currentDate) {
        groups.push({ date, messages: [] })
        currentDate = date
      }
      groups[groups.length - 1].messages.push(msg)
    })
    return groups
  }

  return (
    <div className="flex h-screen w-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-1/3 flex flex-col border-r bg-white overflow-y-auto">
        <div className="p-4 border-b flex justify-between items-center">
          <h2 className="text-xl font-semibold">Chats</h2>
          <button onClick={onLogout} className="bg-red-500 text-white px-3 py-1 rounded-md hover:bg-red-600">Logout</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {friends.map(f => (
            <div key={f._id} onClick={() => setSelectedFriend(f)} className={`p-3 cursor-pointer ${selectedFriend?._id===f._id?'bg-indigo-50 border-l-4 border-indigo-500':'hover:bg-gray-50'}`}>
              <h4 className="font-medium">{f.name}</h4>
              {f.lastMessage && <p className="text-sm text-gray-500 truncate">{f.lastMessage.text}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {selectedFriend ? (
          <>
            <div className="p-4 bg-white border-b">
              <h2 className="font-semibold text-lg">{selectedFriend.name}</h2>
            </div>
            <div className="flex-1 overflow-y-auto bg-gray-50 p-4">
              {messagesLoading ? (
                <div>Loading messages...</div>
              ) : messages.length===0 ? (
                <div className="text-gray-500 text-center mt-10">No messages yet</div>
              ) : (
                groupMessagesByDate().map((group,i)=>(
                  <div key={i} className="mb-4">
                    <div className="flex justify-center my-2">
                      <span className="bg-gray-200 text-gray-600 px-3 py-1 rounded-full text-xs">{group.date}</span>
                    </div>
                    {group.messages.map(msg => {
                      const isCurrentUser = msg.sender === currentUserId
                      return (
                        <div key={msg._id} className={`flex ${isCurrentUser?'justify-end':'justify-start'} mb-2`}>
                          <div className={`${isCurrentUser?'bg-indigo-600 text-white':'bg-white text-gray-800 shadow-sm border border-gray-200'} px-4 py-2 rounded-2xl max-w-xs`}>
                            {msg.text}
                          </div>
                          <div className="text-xs text-gray-500 mt-1 ml-2">{formatTime(msg.createdAt)}</div>
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            <form onSubmit={handleSendMessage} className="p-4 bg-white border-t flex">
              <input type="text" value={newMessage} onChange={e=>setNewMessage(e.target.value)} placeholder="Type a message" className="flex-1 px-4 py-2 border border-gray-300 rounded-l-lg"/>
              <button type="submit" className="bg-indigo-600 text-white px-4 rounded-r-lg">{loading?'Sending':'Send'}</button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-center">
            Select a friend to start chatting
          </div>
        )}
      </div>
    </div>
  )
}
