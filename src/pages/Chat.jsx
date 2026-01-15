import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'
import { Button, Drawer } from 'antd'
import Addfrnds from '../components/Addfrnds'
import Requests from '../components/Requests'
import VoiceCall from '../components/VoiceCall'
import { API_URL, SOCKET_URL } from '../config'

export default function Chat({ onLogout }) {
  /* -----------------------------  STATE  ------------------------------ */
  const [friends, setFriends] = useState([])
  const [selectedFriend, setSelectedFriend] = useState(null)
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [attachments, setAttachments] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [messageSearchQuery, setMessageSearchQuery] = useState('')
  const [messageSearchResults, setMessageSearchResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [currentUserId, setCurrentUserId] = useState(null)
  const [currentUserName, setCurrentUserName] = useState('')
  const messagesEndRef = useRef(null)
  const [socket, setSocket] = useState(null)
  const [socketConnected, setSocketConnected] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0)
  const [callState, setCallState] = useState('idle') // 'idle' | 'calling' | 'incoming' | 'in-call'
  const [callPartner, setCallPartner] = useState(null)
  const callStateRef = useRef(callState)
  useEffect(() => { callStateRef.current = callState }, [callState])
  const [micMissing, setMicMissing] = useState(false)
  const pcRef = useRef(null)
  const localStreamRef = useRef(null)
  const remoteAudioRef = useRef(null)
  const incomingOfferRef = useRef(null)
  const callIdRef = useRef(null)
  // Buffer ICE candidates that arrive before remoteDescription is set
  const pendingIceRef = useRef({})

  // (Call signalling removed)

  // parsed token fallback (quick id/name extraction without server call)
  const parseJwt = t => {
    try {
      if (!t) return null
      const part = t.split('.')[1]
      if (!part) return null
      const decoded = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')))
      return decoded
    } catch (e) { return null }
  }

  // (SDP normalization removed)

  // refs for latest values inside socket handlers (avoid re-registering)
  const selectedFriendRef = useRef(selectedFriend)
  useEffect(() => { selectedFriendRef.current = selectedFriend }, [selectedFriend])
  const currentUserIdRef = useRef(currentUserId)
  useEffect(() => { currentUserIdRef.current = currentUserId }, [currentUserId])
  // Track processed incoming message IDs to avoid double-processing
  const processedMessageIdsRef = useRef(new Set())

  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
  const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB

  /* --------------------------  SOCKET INIT  --------------------------- */
  useEffect(() => {
    // Connect socket as soon as we have a token (don't wait for fetch from /me)
    if (!token) return
    const s = io(SOCKET_URL, { auth: { token } })

    const onConnect = () => {
      console.log('socket connected, emitting register')
      s.emit('register', { token })
      setSocketConnected(true)
    }
    const onReg = () => { console.log('Socket registered', s.id); setSocketConnected(true) }
    const onErr = err => { console.error('Socket connect_error', err); setSocketConnected(false) }
    const onDisconnect = () => { console.log('socket disconnected'); setSocketConnected(false) }

    s.on('connect', onConnect)
    s.on('registered', onReg)
    s.on('connect_error', onErr)
    s.on('disconnect', onDisconnect)
    setSocket(s)

    return () => {
      s.off('connect', onConnect)
      s.off('registered', onReg)
      s.off('connect_error', onErr)
      s.off('disconnect', onDisconnect)
      s.disconnect()
      setSocket(null)
    }
  }, [token])

  // Socket will automatically update online status via online-users broadcast
  // No need to re-fetch friends on socket connect

  /* --------------------------  CURRENT USER  -------------------------- */
  useEffect(() => {
    if (!token) return
    const fetchCurrentUser = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
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

  // quick client-side token decode to get id/name immediately (non-verified)
  useEffect(() => {
    if (!token) return
    try {
      const payload = parseJwt(token)
      const id = payload && (payload.id || payload._id)
      const name = payload && (payload.name || payload.username)
      if (id && !currentUserId) setCurrentUserId(id)
      if (name && !currentUserName) setCurrentUserName(name)
    } catch (e) { /* ignore */ }
  }, [token])

  // Emit user-online when currentUserId becomes available
  useEffect(() => {
    if (!currentUserId || !socket?.connected) return
    console.log('📢 Emitting user-online for:', currentUserId)
    socket.emit('user-online', currentUserId)
  }, [currentUserId, socket?.connected])

  /* ---------------------------  FRIENDS  ------------------------------ */
  const fetchFriends = async () => {
    setFriendsLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/friends`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      })
      const data = await res.json()

      let list = []
      if (Array.isArray(data)) list = data
      else if (Array.isArray(data.friends)) list = data.friends
      else if (Array.isArray(data.data)) list = data.data
      else if (Array.isArray(data.users)) list = data.users

      const formatted = list.map(f => {
        const u = f.user || f.friend || f
        const fid = String(u._id || u.id)
        return {
          _id: fid,
          name: u.name || u.username || 'Unknown',
          email: u.email,
          lastMessage: f.lastMessage || f.last_message,
          unreadCount: f.unreadCount || f.unread_count || 0,
          online: false, // Will be updated by online-users socket broadcast
        }
      })
      console.log('📋 Fetched friends (online status will be updated via socket):', formatted.map(f => f.name))
      setFriends(formatted)
      // Refresh pending requests count after friends list changes (e.g., after accepting a request)
      try { fetchPendingRequestsCount() } catch (e) { /* ignore */ }
      // If socket is connected, ask the server to refresh online status
      // This helps ensure newly-added friends show their real online state
      try {
        if (socket?.connected) {
          console.log('🔔 Requesting online status refresh for current user')
          // Emit user-online so server can update/broadcast online list
          socket.emit('user-online', currentUserId || token)
        }
      } catch (e) {
        console.warn('Failed to request online status refresh', e)
      }
    } catch {
      setFriends([])
    } finally {
      setFriendsLoading(false)
    }
  }
  // Try multiple common endpoints to determine how many pending friend requests exist
  const fetchPendingRequestsCount = async () => {
    if (!token) return
    const endpoints = [
      `${API_URL}/api/requests/pending`,
      `${API_URL}/api/friend-requests`,
      `${API_URL}/api/requests`,
      `${API_URL}/api/friends/requests`,
    ]
    try {
      for (const url of endpoints) {
        try {
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
          if (!res.ok) continue
          const data = await res.json().catch(() => null)
          if (!data) continue
          if (Array.isArray(data)) { setPendingRequestsCount(data.length); return }
          if (Array.isArray(data.requests)) { setPendingRequestsCount(data.requests.length); return }
          if (Array.isArray(data.data)) { setPendingRequestsCount(data.data.length); return }
          if (typeof data.count === 'number') { setPendingRequestsCount(data.count); return }
          if (typeof data.total === 'number') { setPendingRequestsCount(data.total); return }
        } catch (e) {
          // ignore and try next
        }
      }
    } catch (e) {
      // ignore
    }
    setPendingRequestsCount(0)
  }
  useEffect(() => { fetchFriends() }, [])

  // Fetch pending requests count on mount / when token changes
  useEffect(() => { fetchPendingRequestsCount() }, [token])

  // Clear unread count for a friend locally (called when opening the chat)
  const clearUnread = friendId => {
    setFriends(prev => prev.map(f => (String(f._id) === String(friendId) ? { ...f, unreadCount: 0 } : f)))
  }

  // Re-sync online status when friends list loads and socket is ready
  useEffect(() => {
    if (friends.length > 0 && socket?.connected && currentUserId) {
      console.log('🔄 Friends loaded + socket ready, requesting fresh online status')
      setTimeout(() => {
        socket.emit('user-online', currentUserId)
      }, 200)
    }
  }, [friends.length, socket?.connected, currentUserId])

  /* --------------------------  MESSAGES  ------------------------------ */
  const fetchMessages = async friendId => {
    if (!friendId) return
    setMessagesLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/messages?friendId=${friendId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json()
      const normalizeId = v => {
        if (!v) return undefined
        if (typeof v === 'string') return v
        if (typeof v === 'object') return String(v._id || v.id || v)
        return String(v)
      }
      const msgs = (data.messages || data.data || data || []).map(m => ({
        _id: m._id,
        text: m.text || m.content,
        sender: normalizeId(m.sender || m.senderId || m.sender_id),
        receiver: normalizeId(m.receiver || m.receiverId || m.receiver_id || m.to),
        createdAt: m.createdAt || m.created_at || m.timestamp,
        attachments: Array.isArray(m.attachments) ? m.attachments.map(a => ({
          filename: a.filename,
          originalName: a.originalName || a.originalname || a.name,
          mimeType: a.mimeType || a.mimetype,
          size: a.size,
          url: a.url,
          type: a.type || (a.mimetype && a.mimetype.startsWith('image/') ? 'image' : a.mimetype && a.mimetype.startsWith('video/') ? 'video' : 'file')
        })) : []
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

      const normalizeId = v => {
        if (!v && v !== 0) return undefined
        if (typeof v === 'string') return v
        if (typeof v === 'object') return String(v._id || v.id || v)
        return String(v)
      }

      const hasText = msg && Object.prototype.hasOwnProperty.call(msg, 'text')
      const hasContent = msg && Object.prototype.hasOwnProperty.call(msg, 'content')

      const norm = {
        _id: normalizeId(msg._id || msg.id) || Date.now().toString(),
        clientTempId: normalizeId(msg.clientTempId || msg.client_temp_id || msg.tempId),
        // Make `text` optional: only set it when the server provided it (or provided `content`)
        text: hasText ? msg.text : (hasContent ? msg.content : undefined),
        attachments: Array.isArray(msg.attachments) ? msg.attachments : (Array.isArray(msg.files) ? msg.files : []),
        sender: normalizeId(msg.sender || msg.senderId || msg.sender_id),
        receiver: normalizeId(msg.receiver || msg.receiverId || msg.receiver_id || msg.to),
        createdAt: msg.createdAt || msg.created_at || msg.timestamp || new Date().toISOString(),
      }

      // Deduplicate incoming messages to avoid double-counting unread counts
      const msgKey = norm._id || norm.clientTempId || `${norm.sender || ''}:${norm.createdAt || ''}`
      if (processedMessageIdsRef.current.has(msgKey)) {
        console.log('Skipping already-processed message:', msgKey)
        return
      }
      processedMessageIdsRef.current.add(msgKey)

      const me = currentUserIdRef.current ? String(currentUserIdRef.current) : null
      const sid = norm.sender ? String(norm.sender) : null
      const rid = norm.receiver ? String(norm.receiver) : null

      console.log('🔍 Checking message:', { me, sender: sid, receiver: rid, text: norm.text })

      if (!me || (sid !== me && rid !== me)) {
        console.log('⚠️ Ignoring message not for me:', { sender: sid, receiver: rid, me })
        return
      }

      const friendId = (sid && sid !== me) ? sid : rid
      console.log('✅ Message accepted, friendId:', friendId)

      const open = selectedFriendRef.current
      if (open && friendId && String(open._id) === String(friendId)) {
        console.log('💬 Adding to open chat with:', open.name)
        setMessages(prev => {
          const prevIds = new Set(prev.map(m => String(m._id)))

          // If server sent the canonical _id and we already have it, skip
          if (norm._id && prevIds.has(String(norm._id))) return prev

          // If server provided clientTempId, replace the optimistic message
          if (norm.clientTempId) {
            const mapped = prev.map(m => (String(m._id) === String(norm.clientTempId) ? { ...m, ...norm, _id: norm._id } : m))
            // If replacement happened, return mapped
            if (mapped.some((m, i) => String(prev[i]._id) !== String(m._id))) return mapped
          }

          // Heuristic: match optimistic message by sender/receiver/text and close createdAt timestamp
          const approxMatchIndex = prev.findIndex(m => {
            try {
              if (!m) return false
              if (String(m.sender) !== String(norm.sender)) return false
              if (String(m.receiver) !== String(norm.receiver)) return false
              const mText = (m.text || '').toString()
              const nText = (norm.text || '').toString()
              if (mText && nText && mText !== nText) return false
              const a = new Date(m.createdAt || 0).getTime()
              const b = new Date(norm.createdAt || 0).getTime()
              if (!a || !b) return false
              return Math.abs(a - b) < 5000 // within 5s
            } catch (e) { return false }
          })
          if (approxMatchIndex !== -1) {
            const replaced = prev.map((m, i) => i === approxMatchIndex ? { ...m, ...norm, _id: norm._id } : m)
            return replaced
          }

          // Default: append new message
          const next = [...prev, norm]
          console.log('🔁 Messages: prevLength=', prev.length, 'nextLength=', next.length)
          return next
        })
      } else {
        console.log('📬 Updating friend list for:', friendId)
        if (friendId) {
          setFriends(prev => prev.map(f => (String(f._id) === String(friendId) ? { ...f, lastMessage: { text: norm.text, createdAt: norm.createdAt }, unreadCount: (f.unreadCount || 0) + 1 } : f)))
        }
      }
    }

    const onlineStatusHandler = data => {
      console.log('🟢 Friend online status changed:', data)
      if (!data) return
      const rawId = data.userId ?? data.id ?? data._id ?? (data.user && (data.user._id || data.user.id))
      if (rawId == null) {
        console.log('⚠️ No userId found in friendOnlineStatus event')
        return
      }
      const friendId = String(rawId)
      const isOnline = !!(data.online ?? data.isOnline ?? data.status)

      console.log(`🟢 Processing: friendId=${friendId}, isOnline=${isOnline}`)

      // Update friend's online status in the list
      setFriends(prev => {
        const updated = prev.map(f => (String(f._id) === friendId ? { ...f, online: isOnline } : f))
        const friend = updated.find(f => String(f._id) === friendId)
        console.log(`🟢 Updated friends - ${friend?.name || friendId}: ${isOnline ? 'ONLINE' : 'OFFLINE'}`)
        return updated
      })

      // Also update selectedFriend if it's the same person
      setSelectedFriend(prev => {
        if (prev && String(prev._id) === friendId) {
          console.log(`🟢 Updating selectedFriend ${prev.name} online status to:`, isOnline)
          return { ...prev, online: isOnline }
        }
        return prev
      })
    }

    // Listen for broadcast of all online users
    const onlineUsersHandler = (onlineUserIds) => {
      console.log('📡 Received online-users broadcast:', onlineUserIds)
      const onlineSet = new Set(onlineUserIds.map(id => String(id)))

      // Update all friends' online status
      setFriends(prev => prev.map(f => ({
        ...f,
        online: onlineSet.has(String(f._id))
      })))

      // Update selectedFriend if present
      setSelectedFriend(prev => {
        if (!prev) return prev
        return { ...prev, online: onlineSet.has(String(prev._id)) }
      })
    }

    const friendRequestHandler = data => {
      console.log('🔔 Friend request / requests update event:', data)
      try {
        // If server sent an explicit count, use it
        if (typeof data === 'number') { setPendingRequestsCount(data); return }
        if (data && typeof data === 'object') {
          if (Array.isArray(data)) { setPendingRequestsCount(data.length); return }
          if (typeof data.count === 'number') { setPendingRequestsCount(data.count); return }
          if (typeof data.total === 'number') { setPendingRequestsCount(data.total); return }
          // If the payload contains a request object, treat as a new incoming request
          if (data.request || data.newRequest || data.friendRequest || data._id || data.id) { setPendingRequestsCount(prev => (prev || 0) + 1); return }
          // Some servers send an action/event label
          const action = (data.action || data.type || data.event || '').toString().toLowerCase()
          if (action.includes('create') || action.includes('new') || action.includes('received') || action.includes('incoming')) {
            setPendingRequestsCount(prev => (prev || 0) + 1)
            return
          }
        }
      } catch (e) {
        console.warn('friendRequestHandler parse error', e)
      }
      // Fallback: refresh the authoritative count from the server
      try { fetchPendingRequestsCount() } catch (e) { /* ignore */ }
    }

    const friendAcceptedHandler = data => {
      console.log('🔔 Friend request accepted / friend added event:', data)
      try {
        // Prefer authoritative refresh
        fetchFriends()
        fetchPendingRequestsCount()
        // Also decrement locally as a quick response if fetch is slow
        setPendingRequestsCount(prev => Math.max(0, (prev || 0) - 1))
      } catch (e) { console.warn('friendAcceptedHandler error', e) }
    }

    /* Call signalling removed */

    socket.on('newMessage', handler)
    socket.on('friendOnlineStatus', onlineStatusHandler)
    socket.on('online-users', onlineUsersHandler)
    // Common event names for friend-request updates (try multiple names to be resilient)
    socket.on('friendRequest', friendRequestHandler)
    socket.on('newFriendRequest', friendRequestHandler)
    socket.on('requests-updated', friendRequestHandler)
    socket.on('friend-request', friendRequestHandler)
    socket.on('request', friendRequestHandler)
    socket.on('request_received', friendRequestHandler)
    socket.on('requestCreated', friendRequestHandler)
    socket.on('friend_request_created', friendRequestHandler)
    socket.on('incoming-request', friendRequestHandler)
    socket.on('request:created', friendRequestHandler)
    // Events indicating a request was accepted / friend was added
    socket.on('requestAccepted', friendAcceptedHandler)
    socket.on('friendAccepted', friendAcceptedHandler)
    socket.on('friend-added', friendAcceptedHandler)
    socket.on('friend:added', friendAcceptedHandler)
    socket.on('request:accepted', friendAcceptedHandler)
    socket.on('friend_accept', friendAcceptedHandler)
    // Call signalling (listen to multiple event-name variants for compatibility)
    // Call events removed
    return () => {
      socket.off('newMessage', handler)
      socket.off('friendOnlineStatus', onlineStatusHandler)
      socket.off('online-users', onlineUsersHandler)
      socket.off('friendRequest', friendRequestHandler)
      socket.off('newFriendRequest', friendRequestHandler)
      socket.off('requests-updated', friendRequestHandler)
      socket.off('friend-request', friendRequestHandler)
      socket.off('request', friendRequestHandler)
      socket.off('request_received', friendRequestHandler)
      socket.off('requestCreated', friendRequestHandler)
      socket.off('friend_request_created', friendRequestHandler)
      socket.off('incoming-request', friendRequestHandler)
      socket.off('request:created', friendRequestHandler)
      socket.off('requestAccepted', friendAcceptedHandler)
      socket.off('friendAccepted', friendAcceptedHandler)
      socket.off('friend-added', friendAcceptedHandler)
      socket.off('friend:added', friendAcceptedHandler)
      socket.off('request:accepted', friendAcceptedHandler)
      socket.off('friend_accept', friendAcceptedHandler)
      // Call event listeners removed
    }
  }, [socket])

  /* Call features removed */

  // Message search: update results when query or messages change
  useEffect(() => {
    const q = String(messageSearchQuery || '').trim().toLowerCase()
    if (!q) { setMessageSearchResults([]); return }
    try {
      const matches = (messages || []).filter(m => {
        const text = (m.text || '').toString().toLowerCase()
        if (text.includes(q)) return true
        // check attachments' names
        if (Array.isArray(m.attachments)) {
          for (const a of m.attachments) {
            const n = (a.originalName || a.filename || '').toString().toLowerCase()
            if (n.includes(q)) return true
          }
        }
        return false
      })
      setMessageSearchResults(matches)
    } catch (e) {
      setMessageSearchResults([])
    }
  }, [messageSearchQuery, messages])

  // Cleanup any created object URLs for previews
  useEffect(() => {
    return () => {
      attachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
    }
  }, [attachments])

  // Auto-clear error after a short delay
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(''), 5000)
    return () => clearTimeout(t)
  }, [error])

  const handleFileChange = e => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    // Reject files larger than MAX_ATTACHMENT_SIZE
    const oversized = files.filter(f => f.size > MAX_ATTACHMENT_SIZE)
    if (oversized.length > 0) {
      setError('File is larger than 10MB')
      // revoke any created previews just in case (none created yet)
      e.target.value = null
      return
    }
    const mapped = files.map(f => {
      const preview = URL.createObjectURL(f)
      let type = 'file'
      if (f.type && f.type.startsWith('image/')) type = 'image'
      else if (f.type && f.type.startsWith('video/')) type = 'video'
      return { file: f, preview, originalName: f.name, mimeType: f.type, size: f.size, type }
    })
    setError('')
    setAttachments(prev => [...prev, ...mapped])
    e.target.value = null
  }

  // Ref + handler for image-only capture (camera icon)
  const imageInputRef = useRef(null)
  const handleImageCapture = async e => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    // Only keep image files
    const images = files.filter(f => f.type && f.type.startsWith('image/'))
    if (images.length === 0) return

    // Reject images larger than MAX_ATTACHMENT_SIZE
    const oversizedImgs = images.filter(f => f.size > MAX_ATTACHMENT_SIZE)
    if (oversizedImgs.length > 0) {
      setError('File is larger than 10MB')
      e.target.value = null
      return
    }

    // Prepare optimistic local message
    const tempId = `temp-${Date.now()}`
    const mapped = images.map(f => ({ file: f, preview: URL.createObjectURL(f), originalName: f.name, mimeType: f.type, size: f.size, type: 'image' }))
    const localMsg = {
      _id: tempId,
      clientTempId: tempId,
      text: '',
      sender: currentUserId,
      receiver: selectedFriend?._id,
      createdAt: new Date().toISOString(),
      attachments: mapped.map(a => ({ originalName: a.originalName, mimeType: a.mimeType, size: a.size, preview: a.preview, type: a.type }))
    }
    setMessages(prev => {
      const next = prev.some(m => m._id === localMsg._id) ? prev : [...prev, localMsg]
      console.log('Optimistic message added:', localMsg._id)
      // Ensure view scrolls to the newly added optimistic message
      setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 50)
      return next
    })

    // Build FormData and send immediately
    try {
      const form = new FormData()
      const receiverId = selectedFriend?._id || selectedFriend?.id
      if (!receiverId) {
        setError('Invalid recipient')
        return
      }
      form.append('receiver', String(receiverId))
      // Ensure `text` is provided because server validation requires it
      form.append('text', (newMessage && newMessage.trim() !== '') ? newMessage : '[image]')
      form.append('clientTempId', tempId)
      mapped.forEach(a => form.append('attachments', a.file))

      const res = await fetch(`${API_URL}/api/messages/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      })
      const data = await res.json().catch(async () => {
        const txt = await res.text().catch(() => '<no-body>')
        throw new Error(`Server returned non-JSON: ${res.status} ${txt}`)
      })
      if (res.ok) {
        const saved = (data && data.data) ? data.data : (data && (data._id || data.id) ? data : null)
        if (saved) {
          const savedId = saved._id || saved.id
          const savedCreated = saved.createdAt || saved.created_at || saved.timestamp
          const savedAttachments = saved.attachments || saved.files || []
          setMessages(prev => {
            const next = prev.map(m => (m._id === tempId ? { ...m, _id: savedId || m._id, createdAt: savedCreated || m.createdAt, attachments: savedAttachments } : m))
            console.log('Attachment send saved, replaced tempId', tempId, 'with', savedId)
            setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 50)
            return next
          })
        } else {
          console.error('Image send returned OK but no message found', data)
          setError('Server accepted upload but returned unexpected data')
        }
      } else {
        console.error('Image send failed', res.status, data)
        try { console.error('Full response JSON:', JSON.stringify(data, null, 2)) } catch (e) { }
        setError(data.message || JSON.stringify(data.errors || data, null, 2) || 'Failed to send image')
      }
    } catch (err) {
      console.error('Image capture send error', err)
      setError('Failed to send image')
    } finally {
      // revoke previews
      mapped.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
      e.target.value = null
    }
  }

  const removeAttachment = index => {
    setAttachments(prev => {
      const next = [...prev]
      const [removed] = next.splice(index, 1)
      if (removed && removed.preview) URL.revokeObjectURL(removed.preview)
      return next
    })
  }

  const getAttachmentUrl = att => {
    if (!att) return ''
    if (att.preview) return att.preview
    if (!att.url) return ''
    if (att.url.startsWith('http')) return att.url
    return `${SOCKET_URL}${att.url}`
  }

  // Scroll to a specific message and briefly highlight it
  const scrollToMessage = msgId => {
    if (!msgId) return
    const el = document.getElementById(`msg-${msgId}`)
    if (!el) return
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-4', 'ring-yellow-300')
      setTimeout(() => { el.classList.remove('ring-4', 'ring-yellow-300') }, 1800)
    } catch (e) { console.warn('scrollToMessage failed', e) }
  }

  /* --------------------------  SCROLL  -------------------------------- */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* --------------------------  SEND MSG  ------------------------------ */
  const handleSendMessage = async e => {
    e.preventDefault()
    if ((!newMessage.trim() && attachments.length === 0) || !selectedFriend) return
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
      clientTempId: tempId,
      text: newMessage,
      sender: currentUserId,
      receiver: selectedFriend._id,
      createdAt: new Date().toISOString(),
      attachments: attachments.map(a => ({ originalName: a.originalName, mimeType: a.mimeType, size: a.size, preview: a.preview, type: a.type }))
    }
    setMessages(prev => {
      const next = prev.some(m => m._id === localMsg._id) ? prev : [...prev, localMsg]
      console.log('Optimistic message added (send):', localMsg._id)
      setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 50)
      return next
    })
    // If attachments exist, send via REST multipart/form-data (backend saves and Socket.IO will broadcast)
    if (attachments.length > 0) {
      // Guard: ensure none of the attachments exceed size limit
      const hasOversized = attachments.some(a => (a.file && a.file.size > MAX_ATTACHMENT_SIZE) || (a.size && a.size > MAX_ATTACHMENT_SIZE))
      if (hasOversized) {
        setError('File is larger than 10MB')
        setLoading(false)
        return
      }
      try {
        const form = new FormData()
        form.append('receiver', String(receiverId))
        // Always append a non-empty text because backend requires `text`.
        // Use the typed message when present, otherwise provide a short placeholder.
        form.append('text', (newMessage && newMessage.trim() !== '') ? newMessage : '[attachment]')
        form.append('clientTempId', tempId)
        attachments.forEach(a => form.append('attachments', a.file))

        // Debug: enumerate FormData entries (logs filenames for File objects)
        try {
          for (const pair of form.entries()) {
            if (pair[1] && pair[1].name) console.log('FormData entry:', pair[0], pair[1].name)
            else console.log('FormData entry:', pair[0], pair[1])
          }
        } catch (e) { console.warn('FormData enumeration failed', e) }

        const res = await fetch(`${API_URL}/api/messages/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form
        })

        // Parse JSON response (or raw text for debugging) and handle errors
        let data
        try {
          data = await res.json()
        } catch (e) {
          const txt = await res.text().catch(() => '<no-body>')
          console.error('Send attachments non-JSON response', res.status, txt)
          setError(`Server error ${res.status}: ${txt}`)
          setLoading(false)
          return
        }

        if (res.ok) {
          // Normalize different backend response shapes.
          const saved = (data && data.data) ? data.data : (data && (data._id || data.id) ? data : null)
          if (saved) {
            const savedId = saved._id || saved.id
            const savedCreated = saved.createdAt || saved.created_at || saved.timestamp
            const savedAttachments = saved.attachments || saved.files || []
            setMessages(prev => {
              const next = prev.map(m => (m._id === tempId ? { ...m, _id: savedId || m._id, createdAt: savedCreated || m.createdAt, attachments: savedAttachments } : m))
              console.log('Attachment send saved, replaced tempId', tempId, 'with', savedId)
              setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 50)
              return next
            })
          } else {
            console.error('Send attachments returned OK but no message found', data)
            setError('Server accepted upload but returned unexpected data')
          }
        } else {
          console.error('Send attachments failed', res.status, data)
          setError(data.message || data.msg || JSON.stringify(data.errors || data, null, 2) || 'Failed to send attachments')
        }
      } catch (err) {
        console.error('Attachment send error', err)
        setError('Failed to send attachments')
      }
    } else {
      /* Send via Socket.IO only (text-only messages) */
      if (!socketConnected) {
        setError('Socket not connected yet. Please wait a moment.')
        setLoading(false)
        return
      }
      if (socket?.connected) {
        const payload = { to: String(receiverId), text: newMessage, clientTempId: tempId }
        console.log('📤 Emitting sendMessage with payload:', payload)
        socket.emit('sendMessage', payload, ack => {
          console.log('📨 sendMessage ack:', ack)
          if (ack?.ok && ack.data) {
            setMessages(prev => {
              let next
              if (prev.some(m => m._id === ack.data._id)) next = prev.filter(m => m._id !== tempId)
              else next = prev.map(m => m._id === tempId ? { ...m, _id: ack.data._id, createdAt: ack.data.createdAt } : m)
              console.log('Socket ack received, updated message:', ack.data._id)
              setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, 50)
              return next
            })
          } else {
            setError(ack?.message || 'Failed to send')
          }
        })
      } else {
        setError('Not connected to server')
      }
    }
    setNewMessage('')
    // clear attachments and revoke previews
    attachments.forEach(a => { if (a.preview) URL.revokeObjectURL(a.preview) })
    setAttachments([])
    setLoading(false)
  }

  /* --------------------------  LOGOUT  -------------------------------- */
  const handleLogout = async () => {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
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
    // Ensure messages are ordered by time so grouping produces one group per date
    const sorted = [...messages].sort((a, b) => {
      const ta = a && a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b && b.createdAt ? new Date(b.createdAt).getTime() : 0
      return ta - tb
    })

    const groups = []
    let curr = null
    sorted.forEach(m => {
      const date = formatDate(m.createdAt)
      if (date !== curr) { groups.push({ date, messages: [] }); curr = date }
      groups[groups.length - 1].messages.push(m)
    })
    return groups
  }


  // Sync selectedFriend.online when friends list updates
  useEffect(() => {
    if (selectedFriend && friends && friends.length) {
      const found = friends.find(f => String(f._id) === String(selectedFriend._id))
      console.log('🔄 Sync check - selectedFriend:', selectedFriend.name, 'online:', selectedFriend.online, '| found in list:', found?.online)
      // Only promote selectedFriend to online if the friends list reports them online.
      // Do not set them offline here to avoid flicker/duplicate online entries on refresh.
      if (found && found.online && !selectedFriend.online) {
        console.log('🔄 SYNCING selectedFriend.online to true for', selectedFriend.name)
        setSelectedFriend(prev => ({ ...prev, online: true }))
      }
    }
  }, [friends, selectedFriend])

  // Debug logging for messages
  useEffect(() => {
    const test = groupMessagesByDate()
    console.log('TEST groupMessagesByDate result:', test)
    console.log('Current selectedFriend:', selectedFriend)
    console.log('Current messages:', messages)
  }, [messages, groupMessagesByDate])

  // Debug logging for friends online status
  useEffect(() => {
    console.log('Friends list updated:')
    friends.forEach(f => {
      console.log(`  - ${f.name}: ${f.online ? '🟢 ONLINE' : '⚪ OFFLINE'}`)
    })
  }, [friends])

  /* ---------------------------  RENDER  ------------------------------- */
  return (
    <div className="flex h-screen w-screen bg-gray-100 overflow-hidden">
      {/* ------------ Sidebar ------------ */}
      <div className="w-96 flex flex-col bg-white shadow-lg border-r border-gray-200">
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 text-white">
          <div className="p-4 border border-indigo-500 flex items-center space-x-3">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg">
              {currentUserName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{currentUserName}</h3>
              <div className="flex items-center space-x-1.5">
                <span className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
                <span className={`text-xs ${socketConnected ? 'text-green-200' : 'text-gray-400'}`}>{socketConnected ? 'Online' : 'Offline'}</span>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Button type="primary" onClick={() => setDrawerOpen(true)}>Add Friends</Button>
                {pendingRequestsCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded-full">
                    {pendingRequestsCount > 99 ? '99+' : pendingRequestsCount}
                  </span>
                )}
                {micMissing && (
                  <div className="absolute left-0 top-full mt-2 w-96 bg-yellow-50 border border-yellow-200 p-3 rounded text-sm z-50">
                    <div className="font-medium text-yellow-800 mb-1">No microphone detected</div>
                    <div className="text-xs text-gray-700 mb-2">Connect a microphone or install a virtual audio device (VB-Cable / VoiceMeeter).</div>
                    <div className="flex items-center space-x-2">
                      <button type="button" onClick={() => window.open('https://www.vb-audio.com/Cable/', '_blank')} className="px-3 py-1 bg-blue-600 text-white rounded">VB-Cable</button>
                      <button type="button" onClick={() => window.open('https://vb-audio.com/Voicemeeter/', '_blank')} className="px-3 py-1 bg-blue-600 text-white rounded">VoiceMeeter</button>
                      <button type="button" onClick={() => { try { window.open('ms-settings:privacy-microphone') } catch (e) { } }} className="px-3 py-1 bg-gray-200 rounded">Open mic settings</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <Drawer
              title="Add Friends"
              placement="right"
              width={500}
              onClose={() => setDrawerOpen(false)}
              open={drawerOpen}
              extra={
                <div className="space-x-2">
                  <Button onClick={() => setDrawerOpen(false)}>Cancel</Button>
                  <Button type="primary" onClick={() => setDrawerOpen(false)}>OK</Button>
                </div>
              }
            >
              <div className="space-y-4">
                <Requests socket={socket} onFriendAdded={fetchFriends} />
                <Addfrnds socket={socket} onFriendAdded={fetchFriends} />
              </div>
            </Drawer>
          </div>
          <div className=" bg-indigo-700 px-4 py-3 ">
            <h2 className="text-xl font-bold">Chats</h2>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto shadow-lg">
          {friendsLoading ? (
            <div className="p-4 text-center text-gray-500">Loading friends...</div>
          ) : friends.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-sm">No friends yet. Add some!</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {friends.map(f => (
                <div
                  key={f._id}
                  onClick={() => { setSelectedFriend(f); clearUnread(f._id); }}
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
                        <div className="flex items-center space-x-2">
                          <h4 className="font-semibold text-gray-900 truncate">{f.name}</h4>
                          {f.unreadCount > 0 && (
                            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-red-500 text-white rounded-full">
                              {f.unreadCount > 99 ? '99+' : f.unreadCount}
                            </span>
                          )}
                        </div>
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

        <div className="p-5 justify-center space-x-3  border-t border-gray-200 flex">
          <button
            onClick={handleLogout}
            className=" bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white px-4 py-2.5 rounded-md transition-all text-sm font-medium shadow-md hover:shadow-lg"
          >
            Logout
          </button>
        </div>
      </div>

      {/* ------------ Chat Area ------------ */}
      <div className="flex-1 flex flex-col bg-gray-500 shadow-lg">
        {selectedFriend ? (
          <>
            <div className="px-6 py-4  border-b border-gray-200 shadow-lg flex items-center bg-green-500 justify-between bg-gradient-to-b from-gray-50 to-gray-100 ">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center text-white font-bold">
                  {selectedFriend.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <h2 className="font-semibold text-lg text-gray-900">{selectedFriend.name}</h2>
                    <span
                      className={`w-2.5 h-2.5 rounded-full border-2 border-white ${selectedFriend.online ? 'bg-green-400' : 'bg-gray-400'}`}
                      title={selectedFriend.online ? 'Online' : 'Offline'}
                    />
                  </div>
                  <p className="text-xs text-gray-500">{selectedFriend.email}</p>
                </div>
              </div>
              <div className="ml-4 relative flex items-center space-x-3">
                <input
                  type="text"
                  value={messageSearchQuery}
                  onChange={e => setMessageSearchQuery(e.target.value)}
                  placeholder="Search messages..."
                  className="px-3 py-1 rounded-md border border-gray-300 text-sm w-64"
                />
                {messageSearchResults.length > 0 && (
                  <div className="absolute right-0 mt-2 w-72 bg-white border rounded shadow z-50 max-h-60 overflow-y-auto divide-y divide-gray-100">
                    {messageSearchResults.map(r => (
                      <div key={r._id || r.clientTempId || r.createdAt} onClick={() => { scrollToMessage(r._id); setMessageSearchResults([]) }} className="p-2 hover:bg-gray-100 cursor-pointer">
                        <div className="text-sm text-gray-800 truncate">{(r.text && r.text.length > 0) ? r.text : (r.attachments && r.attachments.length > 0 ? '[attachment]' : '<no-content>')}</div>
                        <div className="text-xs text-gray-400">{formatTime(r.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Voice call button placed to the right of the search input */}
                <div className="ml-2">
                  <VoiceCall socket={socket} selectedFriend={selectedFriend} currentUserId={currentUserId} currentUserName={currentUserName} />
                </div>
              </div>
            </div>
            {/* Incoming call UI removed */}

            {/* Remote audio element (hidden) */}
            <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />

            <div className="flex-1 overflow-y-auto bg-white p-6">
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
                  <div key={`${g.date || 'group'}-${i}`} className="mb-6">
                    <div className="flex justify-center my-4">
                      <span className="bg-white shadow-sm text-gray-600 px-4 py-1.5 rounded-full text-xs font-medium">
                        {g.date}
                      </span>
                    </div>
                    {g.messages.map(msg => {
                      const isMe = String(msg.sender) === String(currentUserId)
                      return (
                        <div id={`msg-${msg._id}`} key={msg._id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} mb-3`}>
                          <div className="flex flex-col max-w-md">
                            <div
                              className={`${isMe
                                ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl'
                                : 'bg-white text-gray-800 shadow-md border border-gray-200 rounded-tl-2xl rounded-tr-2xl rounded-br-2xl'
                                } px-4 py-3`}
                            >
                              <div className="break-words">
                                {msg.text && <p>{msg.text}</p>}
                                {msg.attachments && msg.attachments.length > 0 && (
                                  <div className="mt-2 space-y-2">
                                    {msg.attachments.map((att, ai) => {
                                      const src = getAttachmentUrl(att)
                                      if ((att.type || (att.mimeType && att.mimeType.startsWith('image/'))) === 'image') {
                                        return <img key={ai} src={src} alt={att.originalName || att.filename} className="max-w-xs rounded-md" />
                                      }
                                      if ((att.type || (att.mimeType && att.mimeType.startsWith('video/'))) === 'video') {
                                        return (
                                          <video key={ai} src={src} controls className="max-w-xs rounded-md" />
                                        )
                                      }
                                      return (
                                        <div key={ai}>
                                          <a className=" underline" href={src} target="_blank" rel="noreferrer">{att.originalName || att.filename}</a>
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
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

            <form onSubmit={handleSendMessage} className="px-6 py-4  border-t border-gray-200 bg-gradient-to-b from-gray-50 to-gray-100  shadow-lg">
              <div className="space-y-2">
                {error && (
                  <div className="flex items-center justify-between bg-red-50 border border-red-200 text-red-800 px-4 py-2 rounded-md">
                    <div className="text-sm">{error}</div>
                    <button type="button" onClick={() => setError('')} className="text-red-600 font-bold px-2">×</button>
                  </div>
                )}
                {attachments.length > 0 && (
                  <div className="flex items-center space-x-2 mb-2 overflow-x-auto">
                    {attachments.map((a, i) => (
                      <div key={i} className="relative border rounded-md p-1 bg-white">
                        {a.type === 'image' ? (
                          <img src={a.preview} alt={a.originalName} className="w-24 h-24 object-cover rounded-md" />
                        ) : a.type === 'video' ? (
                          <video src={a.preview} className="w-24 h-24 object-cover rounded-md" />
                        ) : (
                          <div className="w-24 h-24 flex items-center justify-center text-sm px-2">{a.originalName}</div>
                        )}
                        <button type="button" onClick={() => removeAttachment(i)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center">×</button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center space-x-3">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input type="file" multiple onChange={handleFileChange} className="hidden" />
                    <div className="px-3 py-2 bg-white rounded-full border border-gray-300 text-sm">Attach</div>
                  </label>

                  {/* Camera / image-only button */}
                  <div>
                    <input ref={imageInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageCapture} className="hidden" />
                    <button type="button" onClick={() => imageInputRef.current?.click()} title="Send image" className="px-3 py-2 bg-white rounded-full border border-gray-300 text-sm">
                      📷
                    </button>
                  </div>

                  <input
                    type="text"
                    value={newMessage}
                    onChange={e => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                  <button
                    type="submit"
                    disabled={loading || ((!newMessage.trim() && attachments.length === 0) || (!socketConnected && attachments.length === 0))}
                    className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white px-6 py-3 rounded-full font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg"
                  >
                    {loading ? 'Sending...' : 'Send'}
                  </button>
                </div>
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

      {/* Right panel removed so chat area uses full width */}
    </div>
  )
}