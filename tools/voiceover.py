# Narrated trailer: neural TTS voice-over timed to autodemo scene marks + burned-in subtitles.
# usage: python tools/voiceover.py tts            -> generates video/vo/*.mp3
#        python tools/voiceover.py build BASE.mp4  -> mixes voice + subtitles into video/overfit-trailer-*.mp4
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VID = os.path.join(ROOT, 'video')
VO = os.path.join(VID, 'vo')
VOICE = 'en-US-AndrewNeural'

# (anchor mark, offset seconds, line)  anchor 'start' = first video frame; N = autodemo step N completed
LINES = [
    ('start', 0.6, "This is OVERFIT: an arena shooter where the enemies learn how you play."),
    (0, 0.3, "Every enemy is a neural network, and every move you make is being recorded."),
    (1, 0.2, "Press B for a brain scan, and watch a hunter's network make decisions in real time."),
    (3, 0.2, "Between waves, the game builds a model of how you play, then evolves its hunters through nearly three thousand simulated fights against your clone, right in your browser."),
    (5, 0.3, "Then it explains exactly what it learned about you."),
    (6, 0.3, "The survivors come for you."),
    (7, 0.2, "Every generation gets better at beating you, specifically."),
    (8, 0.3, "Every third wave, your shadow, a clone of your own behaviour, joins the hunt."),
    (9, 0.2, "The only way to win is to stop being predictable. Play out of distribution, and your score multiplier climbs."),
    (10, 0.4, "OVERFIT. The arena is learning you. No servers, no API keys. Play it now."),
]

def dur(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).decode().strip())

def tts():
    os.makedirs(VO, exist_ok=True)
    for i, (_, _, text) in enumerate(LINES):
        out = os.path.join(VO, f'{i:02d}.mp3')
        subprocess.check_call([sys.executable, '-m', 'edge_tts', '--voice', VOICE, '--rate=+4%', '--text', text, '--write-media', out])
        print(f'{i:02d} {dur(out):5.2f}s  {text[:60]}')

def ts(t):
    h, rem = divmod(t, 3600); m, s = divmod(rem, 60)
    return f'{int(h):02d}:{int(m):02d}:{int(s):02d},{int(round((s - int(s)) * 1000)):03d}'

def build(base):
    marks = json.load(open(base.replace('.mp4', '.marks.json')))
    f0 = marks['f0']
    at = {m['step']: m['t'] - f0 for m in marks['marks']}
    total = dur(base)
    sched, t_end = [], 0.0
    for i, (anchor, off, text) in enumerate(LINES):
        a = 0.0 if anchor == 'start' else at.get(anchor)
        if a is None: continue
        d = dur(os.path.join(VO, f'{i:02d}.mp3'))
        start = max(a + off, t_end + 0.25)
        sched.append((i, start, d, text)); t_end = start + d
    # subtitles: split each line into readable chunks, timed by word share
    srt, n = [], 1
    for i, start, d, text in sched:
        words = text.split(); chunks, cur = [], []
        for w in words:
            cur.append(w)
            if len(' '.join(cur)) > 42 or w.endswith(('.', ',', ':')) and len(cur) > 4: chunks.append(cur); cur = []
        if cur: chunks.append(cur)
        t = start
        for c in chunks:
            cd = d * len(c) / len(words)
            srt.append(f"{n}\n{ts(t)} --> {ts(t + cd)}\n{' '.join(c)}\n"); n += 1; t += cd
    open(os.path.join(VID, 'subs.srt'), 'w', encoding='utf-8').write('\n'.join(srt))
    for i, start, d, text in sched: print(f'{start:6.2f}s +{d:4.2f}  {text[:70]}')
    pad = max(0.0, t_end + 1.2 - total)  # hold the end card so the last line is never cut
    inputs, filt = ['-i', base], []
    for k, (i, start, d, text) in enumerate(sched):
        inputs += ['-i', os.path.join(VO, f'{i:02d}.mp3')]
        filt.append(f'[{k + 1}:a]aresample=48000,adelay={int(start * 1000)}|{int(start * 1000)},volume=1.7[v{k}]')
    vo = ''.join(f'[v{k}]' for k in range(len(sched)))
    filt.append(f'{vo}amix=inputs={len(sched)}:normalize=0[vo]')
    # the recorded game audio starts a few seconds into the file: re-anchor it at t=0 so the
    # mix (and every adelay'd voice line) lines up with the video instead of inheriting that offset
    filt.append(f'[0:a]aresample=async=1:first_pts=0,apad=pad_dur={pad:.2f},volume=0.42[g]')
    filt.append('[g][vo]amix=inputs=2:normalize=0,alimiter=limit=0.95[a]')
    style = "FontName=Segoe UI Semibold,FontSize=15,PrimaryColour=&H00FFFFFF,OutlineColour=&H00180818,BackColour=&H90000000,BorderStyle=1,Outline=2.2,Shadow=1,MarginV=26"
    filt.append(f"[0:v]tpad=stop_mode=clone:stop_duration={pad:.2f},subtitles=subs.srt:force_style='{style}'[v]")
    out1080 = os.path.join(VID, 'overfit-trailer-1080p.mp4')
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(filt), '-map', '[v]', '-map', '[a]',
                           '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-c:a', 'aac', '-b:a', '192k', '-t', f'{total + pad:.2f}', '-movflags', '+faststart', out1080], cwd=VID)
    out720 = os.path.join(VID, 'overfit-trailer-720p.mp4')
    subprocess.check_call(['ffmpeg', '-v', 'error', '-y', '-i', out1080, '-vf', 'scale=1280:720:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24',
                           '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out720])
    print('wrote', out1080, out720)

if __name__ == '__main__':
    tts() if sys.argv[1] == 'tts' else build(os.path.abspath(sys.argv[2]))
