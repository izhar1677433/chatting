import React, { useEffect, useRef, useState } from 'react'

// Minimal voice call component using Socket.IO signaling + WebRTC
// Props: socket, selectedFriend, currentUserId, currentUserName
export default function VoiceCall({ socket, selectedFriend, currentUserId, currentUserName }) {
    const pcRef = useRef(null)
    const localStreamRef = useRef(null)
    const remoteAudioRef = useRef(null)
    const [callStatus, setCallStatus] = useState('idle') // idle | calling | incoming | in-call
    const [micAlert, setMicAlert] = useState('')
    const incomingOfferRef = useRef(null)

    useEffect(() => {
        if (!socket) return
        const normalizeOffer = (payload) => {
            if (!payload) return null
            // common shapes: { from, to, type, sdp }, { offer: { type, sdp }, from }
            let from = payload.from || payload.fromId || payload.caller || payload.from_user || (payload.offer && payload.offer.from)
            let sdp = payload.sdp || (payload.offer && (payload.offer.sdp || payload.offer.sdpDescription)) || (payload.payload && payload.payload.sdp)
            let type = payload.type || (payload.offer && payload.offer.type) || 'offer'
            if (!sdp && payload && typeof payload === 'string' && payload.indexOf('v=0') !== -1) sdp = payload
            if (!sdp) return null
            return { from: String(from || ''), type, sdp }
        }

        const onOffer = async (raw) => {
            try {
                console.log('VoiceCall: received raw offer', raw)
                const payload = normalizeOffer(raw)
                if (!payload) {
                    console.warn('VoiceCall: unable to normalize incoming offer', raw)
                    return
                }
                incomingOfferRef.current = payload
                console.log('VoiceCall: normalized incoming offer', { from: payload.from, sdpLen: payload.sdp && payload.sdp.length })
                setCallStatus('incoming')
            } catch (e) { console.warn('onOffer handler failed', e) }
        }
        const onAnswer = async (payload) => {
            console.log('VoiceCall: received answer', payload)
            try {
                if (!pcRef.current) return
                const ans = payload && payload.sdp ? { type: payload.type || 'answer', sdp: payload.sdp } : payload
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(ans))
                setCallStatus('in-call')
            } catch (e) { console.warn('setRemoteDescription(answer) failed', e) }
        }
        const onIce = async (payload) => {
            try {
                const cand = payload && (payload.candidate || payload.candidate?.candidate) ? (payload.candidate || payload) : payload
                if (!cand || !pcRef.current) return
                await pcRef.current.addIceCandidate(new RTCIceCandidate(cand))
            } catch (e) { console.warn('addIceCandidate failed', e) }
        }

        // listen to multiple common offer event names for compatibility with various servers
        const offerEvents = ['webrtc-offer', 'call:offer', 'call-offer', 'offer', 'incoming-call']
        offerEvents.forEach(ev => socket.on(ev, onOffer))
        socket.on('webrtc-answer', onAnswer)
        socket.on('ice-candidate', onIce)

        return () => {
            offerEvents.forEach(ev => socket.off(ev, onOffer))
            socket.off('webrtc-answer', onAnswer)
            socket.off('ice-candidate', onIce)
        }
    }, [socket])

    const createPC = (partnerId) => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
        pc.onicecandidate = e => {
            if (e.candidate && socket?.connected) {
                // emit ICE candidate using fallback event names to maximize server compatibility
                emitWithAckFallback(['ice-candidate', 'webrtc-ice', 'candidate', 'ice'], { to: String(partnerId), candidate: e.candidate, from: String(currentUserId) }, 2500).catch(() => { })
            }
        }
        pc.ontrack = e => {
            try {
                if (remoteAudioRef.current) {
                    remoteAudioRef.current.srcObject = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track])
                    remoteAudioRef.current.play().catch(() => { })
                }
            } catch (err) { console.warn('ontrack error', err) }
        }
        return pc
    }

    // Check whether the browser can see any audio input devices
    const hasAudioInputDevice = async () => {
        try {
            if (!navigator?.mediaDevices || !navigator.mediaDevices.enumerateDevices) return true
            const devices = await navigator.mediaDevices.enumerateDevices()
            const audioInputs = devices.filter(d => d.kind === 'audioinput')
            return audioInputs && audioInputs.length > 0
        } catch (e) {
            console.warn('hasAudioInputDevice check failed', e)
            return true
        }
    }

    // Try emitting across several event names until server acks (or all tried)
    const emitWithAckFallback = (events, payload, timeout = 2500) => {
        return new Promise((resolve) => {
            if (!socket) return resolve(null)
            let idx = 0
            const tryNext = () => {
                if (idx >= events.length) return resolve(null)
                const ev = events[idx++]
                let done = false
                const timer = setTimeout(() => {
                    if (!done) tryNext()
                }, timeout + 100)
                try {
                    socket.emit(ev, payload, (ack) => {
                        done = true
                        clearTimeout(timer)
                        resolve({ event: ev, ack })
                    })
                } catch (e) {
                    clearTimeout(timer)
                    tryNext()
                }
            }
            tryNext()
        })
    }

    const startCall = async () => {
        if (!selectedFriend || !socket?.connected) return
        setCallStatus('calling')
        try {
            const ok = await hasAudioInputDevice()
            if (!ok) {
                const msg = 'No microphone found or access denied. Connect and allow microphone.'
                console.error('startCall: no audio input device found')
                setMicAlert(msg)
                setCallStatus('idle')
                return
            }
            const s = await navigator.mediaDevices.getUserMedia({ audio: true })
            setMicAlert('')
            localStreamRef.current = s
            // prefer user id but fall back to other identifiers
            const partnerUserId = selectedFriend._id || selectedFriend.userId || selectedFriend.id || ''
            pcRef.current = createPC(partnerUserId)
            s.getAudioTracks().forEach(t => pcRef.current.addTrack(t, s))
            const offer = await pcRef.current.createOffer()
            await pcRef.current.setLocalDescription(offer)

            const payload = {
                to: String(partnerUserId),
                toSocket: selectedFriend.socketId || selectedFriend.sid || selectedFriend.socket || null,
                from: String(currentUserId),
                fromSocket: socket?.id || null,
                fromName: currentUserName || '',
                type: 'offer',
                sdp: offer.sdp
            }

            const offerEvents = ['webrtc-offer', 'call:offer', 'call-offer', 'offer', 'incoming-call']
            const res = await emitWithAckFallback(offerEvents, payload, 2500)
            console.log('VoiceCall: offer emit result', res || 'no-ack', payload)

            if (!res) {
                console.warn('VoiceCall: server did not ack any offer event; sending fallback raw emits')
                // try fire-and-forget emits across common event names (increase chance server receives)
                offerEvents.forEach(ev => {
                    try { socket.emit(ev, payload) } catch (_) { }
                })
                console.log('VoiceCall: sent offer fallback (no-ack)', payload)
                // leave status as 'calling' while waiting for answer
            }
        } catch (e) {
            console.error('startCall failed', e)
            try { if (pcRef.current) { pcRef.current.close(); pcRef.current = null } } catch (_) { }
            try { if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null } } catch (_) { }
            setCallStatus('idle')
        }
    }

    const acceptCall = async () => {
        try {
            console.log('acceptCall: start')
            const payload = incomingOfferRef.current
            if (!payload) {
                console.warn('acceptCall: no incoming payload')
                return
            }
            console.log('acceptCall: payload', payload && typeof payload === 'object' ? { from: payload.from, type: payload.type, sdpLen: payload.sdp && payload.sdp.length } : payload)

            // create peer connection first
            pcRef.current = createPC(payload.from)

            // set remote description (use plain object for compatibility)
            const offerDesc = { type: payload.type || 'offer', sdp: payload.sdp }
            console.log('acceptCall: setting remote description')
            await pcRef.current.setRemoteDescription(offerDesc)

            // then get local audio and add tracks
            const ok = await hasAudioInputDevice()
            if (!ok) {
                const msg = 'No microphone found or access denied. Connect and allow microphone.'
                console.error('acceptCall: no audio input device found')
                setMicAlert(msg)
                setCallStatus('idle')
                return
            }
            const s = await navigator.mediaDevices.getUserMedia({ audio: true })
            setMicAlert('')
            localStreamRef.current = s
            s.getAudioTracks().forEach(t => pcRef.current.addTrack(t, s))

            // create and set local answer
            console.log('acceptCall: creating answer')
            const answer = await pcRef.current.createAnswer()
            await pcRef.current.setLocalDescription(answer)

            const ansPayload = { to: String(payload.from), from: String(currentUserId), type: 'answer', sdp: answer.sdp }
            socket.emit('webrtc-answer', ansPayload)
            console.log('VoiceCall: sent answer', ansPayload)
            setCallStatus('in-call')
            incomingOfferRef.current = null
        } catch (e) {
            console.error('acceptCall failed', e)
            // cleanup partially created pc/streams
            try { if (pcRef.current) { pcRef.current.close(); pcRef.current = null } } catch (_) { }
            try { if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null } } catch (_) { }
            setCallStatus('idle')
        }
    }

    const rejectCall = () => {
        incomingOfferRef.current = null
        setCallStatus('idle')
    }

    const hangup = () => {
        try {
            if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
            if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null }
            setCallStatus('idle')
            // optionally notify server
            if (socket?.connected && selectedFriend) socket.emit('call-hangup', { to: String(selectedFriend._id) })
        } catch (e) { console.warn('hangup failed', e) }
    }

    return (
        <div className="voice-call-ui">
            {micAlert && (
                <div className="mb-2 p-2 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs flex items-center justify-between">
                    <div>{micAlert}</div>
                    <button onClick={() => setMicAlert('')} className="ml-2 text-red-600 font-bold">×</button>
                </div>
            )}
            <audio ref={remoteAudioRef} autoPlay style={{ display: 'none' }} />
            {callStatus === 'idle' && selectedFriend && (
                <div className="voice-call-button flex items-center space-x-2">
                    <button onClick={startCall} className="inline-flex items-center gap-2 px-3 py-1 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white rounded-md text-sm shadow-sm">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                            <path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 01.95-.27 11.36 11.36 0 003.55.57 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1 11.36 11.36 0 00.57 3.55 1 1 0 01-.27.95l-2.18 2.29z" />
                        </svg>
                        <span>Call</span>
                    </button>
                </div>
            )}
            {callStatus === 'calling' && (
                <button disabled className="px-3 py-1 bg-yellow-400 text-white rounded-md text-sm">Calling...</button>
            )}
            {callStatus === 'incoming' && (
                <div className="inline-flex items-center space-x-2">
                    <span className="text-sm">Incoming...</span>
                    <button onClick={() => { console.log('Accept clicked', incomingOfferRef.current); acceptCall() }} className="px-3 py-1 bg-green-500 text-white rounded-md text-sm">Accept</button>
                    <button onClick={() => { console.log('Reject clicked', incomingOfferRef.current); rejectCall() }} className="px-3 py-1 bg-red-500 text-white rounded-md text-sm">Reject</button>
                    <div className="text-xs text-gray-400">
                        {incomingOfferRef.current ? `from:${incomingOfferRef.current.from || 'unknown'} sdpLen:${incomingOfferRef.current.sdp ? incomingOfferRef.current.sdp.length : 0}` : 'no-offer'}
                    </div>
                </div>
            )}
            {callStatus === 'in-call' && (
                <button onClick={hangup} className="px-3 py-1 bg-red-500 text-white rounded-md text-sm">Hang Up</button>
            )}
        </div>
    )
}
