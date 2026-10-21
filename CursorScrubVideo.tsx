import { useEffect, useRef, useState, type CSSProperties } from "react"
import { addPropertyControls, ControlType } from "framer"

/**
 * Scrubs a muted video from cursor position. Playback is seek-only: the
 * element never stays playing.
 *
 * For buttery scrubbing, the uploaded video must be encoded with every frame
 * as a keyframe. Recommended:
 * ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 18 -g 1 -keyint_min 1 -x264-params "scenecut=0" -profile:v high -pix_fmt yuv420p -movflags +faststart -an out.mp4
 *
 * @framerSupportedLayoutWidth any
 * @framerSupportedLayoutHeight any
 */
export default function CursorScrubVideo(props: CursorScrubVideoProps) {
    const {
        videoFile,
        axis = "horizontal",
        reverse = false,
        trackingArea = "component",
        smoothing = 0.22,
        objectFit = "cover",
        showPoster = true,
        borderRadius = 0,
        style,
    } = props

    const rootRef = useRef<HTMLDivElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    const posRef = useRef(0)
    const currentTimeRef = useRef(0)
    const seekingRef = useRef(false)
    const readyRef = useRef(false)
    const axisRef = useRef(axis)
    const reverseRef = useRef(reverse)
    const smoothingRef = useRef(smoothing)
    const [ready, setReady] = useState(false)
    const [failed, setFailed] = useState(false)
    const [src, setSrc] = useState<string | null>(null)

    axisRef.current = axis
    reverseRef.current = reverse
    smoothingRef.current = clampSmoothing(smoothing)

    useEffect(() => {
        const resolved = resolveVideoSource(videoFile)
        if (!resolved) {
            setSrc(null)
            setReady(false)
            setFailed(false)
            readyRef.current = false
            return
        }

        setSrc(resolved.url)
        setReady(false)
        setFailed(false)
        readyRef.current = false
        seekingRef.current = false
        currentTimeRef.current = 0
        posRef.current = 0

        return () => {
            if (resolved.revoke) URL.revokeObjectURL(resolved.url)
        }
    }, [videoFile])

    useEffect(() => {
        const video = videoRef.current
        if (!video || !src) return

        readyRef.current = false
        seekingRef.current = false
        currentTimeRef.current = 0
        setReady(false)
        setFailed(false)

        const onSeeking = () => {
            seekingRef.current = true
        }
        const onSeeked = () => {
            seekingRef.current = false
        }
        const markReady = () => {
            readyRef.current = true
            setReady(true)
            video.pause()
        }
        const onError = () => {
            readyRef.current = false
            setFailed(true)
        }

        video.addEventListener("seeking", onSeeking)
        video.addEventListener("seeked", onSeeked)
        video.addEventListener("canplaythrough", markReady)
        video.addEventListener("error", onError)

        video.muted = true
        video.defaultMuted = true
        video.playsInline = true
        video.disableRemotePlayback = true
        video.preload = "auto"
        try {
            video.load()
            video.play().then(() => video.pause()).catch(() => {})
            video.currentTime = 0
        } catch {
            readyRef.current = false
        }

        if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) markReady()

        return () => {
            video.removeEventListener("seeking", onSeeking)
            video.removeEventListener("seeked", onSeeked)
            video.removeEventListener("canplaythrough", markReady)
            video.removeEventListener("error", onError)
            video.pause()
        }
    }, [src])

    useEffect(() => {
        if (!src) return
        const root = rootRef.current
        if (trackingArea === "component" && !root) return

        const target: Window | HTMLDivElement = trackingArea === "window" ? window : root!
        const onPointerMove = (event: Event) => {
            if (!(event instanceof PointerEvent)) return
            posRef.current = cursorToPos(event, trackingArea, root, axisRef.current, reverseRef.current)
        }

        target.addEventListener("pointermove", onPointerMove)
        return () => target.removeEventListener("pointermove", onPointerMove)
    }, [src, trackingArea])

    useEffect(() => {
        if (!src) return
        let frame = 0

        const tick = () => {
            const video = videoRef.current
            if (video) {
                if (!readyRef.current || !Number.isFinite(video.duration) || video.duration <= 0) {
                    currentTimeRef.current = 0
                    if (!seekingRef.current && video.currentTime > 0.008) video.currentTime = 0
                } else {
                    const target = posRef.current * video.duration
                    const next = currentTimeRef.current + (target - currentTimeRef.current) * smoothingRef.current
                    currentTimeRef.current = next
                    if (!seekingRef.current && Math.abs(video.currentTime - next) > 0.008) {
                        video.currentTime = clamp(next, 0, video.duration)
                    }
                }
            }
            frame = requestAnimationFrame(tick)
        }

        frame = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frame)
    }, [src])

    const radius = `${borderRadius}px`
    const frameStyle: CSSProperties = {
        width: "100%",
        height: "100%",
        position: "relative",
        ...style,
        overflow: "hidden",
        borderRadius: radius,
        background: src ? "transparent" : "#ececec",
        color: "#1a1a1a",
        display: src ? "block" : "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
    }

    if (!src) {
        return (
            <div ref={rootRef} style={frameStyle}>
                Add a video file
            </div>
        )
    }

    return (
        <div ref={rootRef} style={frameStyle}>
            <video
                ref={videoRef}
                src={src}
                muted
                playsInline
                preload="auto"
                disableRemotePlayback
                controls={false}
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit,
                    borderRadius: radius,
                    display: "block",
                    opacity: showPoster || ready ? 1 : 0,
                    pointerEvents: "none",
                }}
            />
            {!ready && !showPoster && !failed && <StatusLabel>Loading video</StatusLabel>}
            {failed && <StatusLabel>Couldn’t load video</StatusLabel>}
        </div>
    )
}

function StatusLabel({ children }: { children: string }) {
    return (
        <div
            style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#f5f5f5",
                fontFamily: "Inter, system-ui, sans-serif",
                fontSize: 14,
                pointerEvents: "none",
            }}
        >
            {children}
        </div>
    )
}

type Axis = "horizontal" | "vertical"
type TrackingArea = "component" | "window"
type ObjectFit = "cover" | "contain" | "fill"

type VideoFileValue =
    | string
    | { url?: string; src?: string }
    | File
    | Blob
    | null
    | undefined

interface CursorScrubVideoProps {
    videoFile?: VideoFileValue
    axis?: Axis
    reverse?: boolean
    trackingArea?: TrackingArea
    smoothing?: number
    objectFit?: ObjectFit
    showPoster?: boolean
    borderRadius?: number
    style?: CSSProperties
}

function resolveVideoSource(file: VideoFileValue): { url: string; revoke: boolean } | null {
    if (!file) return null
    if (typeof file === "string") {
        const url = file.trim()
        return url ? { url, revoke: false } : null
    }
    if (typeof file !== "object") return null
    if (typeof Blob !== "undefined" && file instanceof Blob) {
        return { url: URL.createObjectURL(file), revoke: true }
    }
    const record = file as { url?: unknown; src?: unknown }
    const url = typeof record.url === "string" ? record.url : typeof record.src === "string" ? record.src : ""
    const trimmed = url.trim()
    return trimmed ? { url: trimmed, revoke: false } : null
}

function cursorToPos(
    event: PointerEvent,
    trackingArea: TrackingArea,
    root: HTMLDivElement | null,
    axis: Axis,
    reverse: boolean
) {
    let x = 0
    let y = 0
    if (trackingArea === "window") {
        const width = window.innerWidth || 1
        const height = window.innerHeight || 1
        x = clamp(event.clientX / width, 0, 1)
        y = clamp(event.clientY / height, 0, 1)
    } else if (root) {
        const rect = root.getBoundingClientRect()
        const width = rect.width || 1
        const height = rect.height || 1
        x = clamp(event.offsetX / width, 0, 1)
        y = clamp(event.offsetY / height, 0, 1)
    }
    let pos = axis === "horizontal" ? x : y
    if (reverse) pos = 1 - pos
    return pos
}

function clamp(value: number, min: number, max: number) {
    if (Number.isNaN(value)) return min
    return Math.min(max, Math.max(min, value))
}

function clampSmoothing(value: number) {
    return clamp(value, 0.02, 1)
}

addPropertyControls(CursorScrubVideo, {
    videoFile: {
        type: ControlType.File,
        title: "Video",
        allowedFileTypes: ["video/*", "mp4", "webm", "mov", "m4v", "ogg"],
        description:
            "Every frame must be a keyframe. ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 18 -g 1 -keyint_min 1 -x264-params \"scenecut=0\" -profile:v high -pix_fmt yuv420p -movflags +faststart -an out.mp4",
    },
    axis: {
        type: ControlType.Enum,
        title: "Axis",
        defaultValue: "horizontal",
        options: ["horizontal", "vertical"],
        optionTitles: ["Horizontal", "Vertical"],
        displaySegmentedControl: true,
    },
    reverse: {
        type: ControlType.Boolean,
        title: "Reverse",
        defaultValue: false,
        enabledTitle: "On",
        disabledTitle: "Off",
    },
    trackingArea: {
        type: ControlType.Enum,
        title: "Tracking",
        defaultValue: "component",
        options: ["component", "window"],
        optionTitles: ["Component", "Window"],
        displaySegmentedControl: true,
    },
    smoothing: {
        type: ControlType.Number,
        title: "Smoothing",
        defaultValue: 0.22,
        min: 0.02,
        max: 1,
        step: 0.01,
        description: "Higher is snappier. Lower keeps more inertia.",
    },
    objectFit: {
        type: ControlType.Enum,
        title: "Fit",
        defaultValue: "cover",
        options: ["cover", "contain", "fill"],
        optionTitles: ["Cover", "Contain", "Fill"],
        displaySegmentedControl: true,
    },
    showPoster: {
        type: ControlType.Boolean,
        title: "Show Poster",
        defaultValue: true,
        description: "Shows the first frame while the file buffers.",
        enabledTitle: "On",
        disabledTitle: "Off",
    },
    borderRadius: {
        type: ControlType.Number,
        title: "Radius",
        defaultValue: 0,
        min: 0,
        step: 1,
        unit: "px",
    },
})
