import { useCallback, useRef, useState } from 'react'

const TRACK_HEIGHT = 30
const LABEL_WIDTH = 100
const PIXELS_PER_SECOND = 80

export default function TimelinePanel({
  duration,
  currentTime,
  setCurrentTime,
  tracks,
  onDeleteKeyframe,
  onMoveKeyframe,
  actors,
  cameras,
  fps,
}) {
  const scrubRef = useRef(null)
  const [dragging, setDragging] = useState(null)
  const [localTracks, setLocalTracks] = useState(null)
  const displayTracks = dragging ? (localTracks || tracks) : tracks

  const handleScrub = useCallback((event) => {
    if (!scrubRef.current) return
    const rect = scrubRef.current.getBoundingClientRect()
    const x = event.clientX - rect.left
    setCurrentTime(Math.max(0, Math.min(duration, x / PIXELS_PER_SECOND)))
  }, [duration, setCurrentTime])

  const startDragKeyframe = (event, targetType, targetId, keyframeIndex) => {
    event.stopPropagation()
    setLocalTracks(tracks)
    setDragging({ targetType, targetId, keyframeIndex, startX: event.clientX })
  }

  const moveDraggingKeyframe = useCallback((event) => {
    if (!dragging) return
    const delta = (event.clientX - dragging.startX) / PIXELS_PER_SECOND
    const sourceTracks = localTracks || tracks
    const updated = sourceTracks.map((track) => {
      if (track.targetType !== dragging.targetType || track.targetId !== dragging.targetId) return track
      const keyframes = track.keyframes.map((keyframe, index) => (
        index === dragging.keyframeIndex
          ? { ...keyframe, time: Math.max(0, Math.min(duration, keyframe.time + delta)) }
          : keyframe
      )).sort((a, b) => a.time - b.time)
      return { ...track, keyframes }
    })
    setLocalTracks(updated)
    setDragging((prev) => ({ ...prev, startX: event.clientX }))
  }, [dragging, duration, localTracks, tracks])

  const endDraggingKeyframe = useCallback(() => {
    if (dragging && onMoveKeyframe) {
      const changed = (localTracks || tracks).find((track) => track.targetType === dragging.targetType && track.targetId === dragging.targetId)
      if (changed) onMoveKeyframe(dragging.targetType, dragging.targetId, changed.keyframes)
    }
    setDragging(null)
    setLocalTracks(null)
  }, [dragging, localTracks, onMoveKeyframe, tracks])

  const markers = []
  for (let time = 0; time <= duration; time += Math.max(1, Math.round(duration / 20))) markers.push(time)

  const renderKeyframe = (track, keyframe, index, className = '') => (
    <div
      key={`${track.targetType}-${track.targetId}-${index}`}
      className={`timeline-keyframe ${className}`}
      style={{ left: keyframe.time * PIXELS_PER_SECOND - 4 }}
      title={`${keyframe.time.toFixed(1)}s，拖动移动，双击删除`}
      onMouseDown={(event) => startDragKeyframe(event, track.targetType, track.targetId, index)}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onDeleteKeyframe?.(track.targetType, track.targetId, index)
      }}
    />
  )

  return (
    <div className="previz-timeline" onMouseMove={moveDraggingKeyframe} onMouseUp={endDraggingKeyframe} onMouseLeave={endDraggingKeyframe}>
      <div className="timeline-header" style={{ paddingLeft: LABEL_WIDTH }}>
        {markers.map((time) => (
          <div key={time} className="timeline-marker" style={{ left: time * PIXELS_PER_SECOND }}>
            <div className="timeline-marker-line" />
            <span className="timeline-marker-label">{time}s</span>
          </div>
        ))}
      </div>

      <div className="timeline-tracks">
        <div style={{ position: 'relative', minWidth: duration * PIXELS_PER_SECOND + LABEL_WIDTH + 100 }}>
          <div className="timeline-playhead" style={{ left: LABEL_WIDTH + currentTime * PIXELS_PER_SECOND }} />

          <div className="timeline-track" style={{ height: TRACK_HEIGHT }}>
            <div className="timeline-track-label" style={{ width: LABEL_WIDTH }}>摄影机</div>
            <div className="timeline-track-canvas" ref={scrubRef} onClick={handleScrub} style={{ width: duration * PIXELS_PER_SECOND }}>
              {displayTracks.filter((track) => track.targetType === 'camera').flatMap((track) => (
                (track.keyframes || []).map((keyframe, index) => renderKeyframe(track, keyframe, index, 'cam-keyframe'))
              ))}
            </div>
          </div>

          {(actors || []).map((actor) => {
            const actorTrack = displayTracks.find((track) => track.targetType === 'actor' && track.targetId === actor.id)
            return (
              <div key={actor.id} className="timeline-track" style={{ height: TRACK_HEIGHT }}>
                <div className="timeline-track-label" style={{ width: LABEL_WIDTH }}>
                  <span className="actor-color-dot" style={{ background: actor.color }} />
                  {actor.name}
                </div>
                <div className="timeline-track-canvas" onClick={handleScrub} style={{ width: duration * PIXELS_PER_SECOND }}>
                  {(actorTrack?.keyframes || []).map((keyframe, index) => renderKeyframe(actorTrack, keyframe, index))}
                </div>
              </div>
            )
          })}

          {(cameras || []).filter((camera) => !displayTracks.some((track) => track.targetType === 'camera' && track.targetId === camera.id)).length > 0 && null}
        </div>
      </div>

      <div className="timeline-footer">
        <span>时长：{duration}s | FPS：{fps} | 拖动关键帧移动，双击删除</span>
      </div>
    </div>
  )
}
