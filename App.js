import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

const RECORD_FILE = `${FileSystem.documentDirectory}mood-records.json`;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MOODS = [
  { emoji: '😊', label: '开心', detail: '开心/平静', color: '#ffd447' },
  { emoji: '😡', label: '暴躁', detail: '愤怒/暴躁', color: '#ff4b4b' },
  { emoji: '😭', label: '难过', detail: '难过/委屈', color: '#316dff' },
  { emoji: '🤮', label: '下班', detail: '恶心/下班', color: '#55dd74' },
  { emoji: '😴', label: '困倦', detail: '困倦/无动力', color: '#8f7bff' },
];

const REMINDER_COPY = [
  '砰！今天的情绪子弹已装填，现在的你感觉如何？',
  '别看了，快来按一下，今天过得爽吗？',
  '两秒就够，给现在的情绪留个弹孔。',
  'MoodBullet 到点，按一下就撤。',
];

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function App() {
  const [records, setRecords] = useState([]);
  const [tab, setTab] = useState('capture');
  const [burst, setBurst] = useState(null);
  const [savedMood, setSavedMood] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    loadRecords().then(setRecords);
  }, []);

  const addRecord = useCallback(async (mood, x, y) => {
    const nextRecord = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: Date.now(),
      emoji: mood.emoji,
      tag: '',
    };
    const nextRecords = [...records, nextRecord];

    setRecords(nextRecords);
    await saveRecords(nextRecords);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    setBurst({ id: nextRecord.id, x, y, color: mood.color });
    setSavedMood(mood);
    setTimeout(() => setSavedMood(null), 500);
  }, [records]);

  const enableNotifications = useCallback(async () => {
    try {
      const message = await scheduleMoodNotifications();
      setToast(message);
    } catch (error) {
      setToast('通知开启失败，请检查系统权限');
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.app}>
        <Header tab={tab} setTab={setTab} />
        {tab === 'capture' ? (
          <CaptureScreen onCapture={addRecord} />
        ) : (
          <CanvasScreen
            records={records}
            toast={toast}
            onEnableNotifications={enableNotifications}
          />
        )}
      </View>

      {burst ? <ParticleBurst burst={burst} onDone={() => setBurst(null)} /> : null}
      {savedMood ? <SavedOverlay mood={savedMood} /> : null}
    </SafeAreaView>
  );
}

function Header({ tab, setTab }) {
  return (
    <View style={styles.header}>
      <Pressable style={styles.brand} onPress={() => setTab('capture')}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>MB</Text>
        </View>
        <Text style={styles.brandText}>MoodBullet</Text>
      </Pressable>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === 'capture' && styles.tabActive]}
          onPress={() => setTab('capture')}
        >
          <Text style={[styles.tabText, tab === 'capture' && styles.tabTextActive]}>记录</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'canvas' && styles.tabActive]}
          onPress={() => setTab('canvas')}
        >
          <Text style={[styles.tabText, tab === 'canvas' && styles.tabTextActive]}>画布</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CaptureScreen({ onCapture }) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <View style={styles.capture}>
      <Text style={styles.timeChip}>
        {time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
      </Text>
      <Text style={styles.title}>现在是什么情绪？</Text>
      <View style={styles.moodGrid}>
        {MOODS.map((mood) => (
          <MoodButton key={mood.emoji} mood={mood} onCapture={onCapture} />
        ))}
      </View>
    </View>
  );
}

function MoodButton({ mood, onCapture }) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.moodButton,
        mood.emoji === '😴' && styles.moodButtonWide,
        pressed && styles.moodButtonPressed,
      ]}
      onPress={(event) => {
        const { pageX, pageY } = event.nativeEvent;
        onCapture(mood, pageX || SCREEN_WIDTH / 2, pageY || 380);
      }}
    >
      <Text style={styles.moodEmoji}>{mood.emoji}</Text>
      <Text style={styles.moodLabel}>{mood.label}</Text>
    </Pressable>
  );
}

function SavedOverlay({ mood }) {
  return (
    <View style={styles.savedOverlay} pointerEvents="none">
      <Text style={styles.savedEmoji}>{mood.emoji}</Text>
      <Text style={styles.savedText}>已记录</Text>
    </View>
  );
}

function ParticleBurst({ burst, onDone }) {
  const progress = useRef(new Animated.Value(0)).current;
  const particles = useMemo(() => {
    return Array.from({ length: 38 }, (_, index) => {
      const angle = seeded(index + 8) * Math.PI * 2;
      const distance = 72 + seeded(index + 31) * 150;
      return {
        id: index,
        dx: Math.cos(angle) * distance,
        dy: Math.sin(angle) * distance,
        size: 5 + seeded(index + 71) * 10,
      };
    });
  }, [burst.id]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 640,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(onDone);
  }, [onDone, progress]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((particle) => {
        const translateX = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.dx],
        });
        const translateY = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, particle.dy],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0],
        });

        return (
          <Animated.View
            key={particle.id}
            style={[
              styles.particle,
              {
                left: burst.x,
                top: burst.y,
                width: particle.size,
                height: particle.size,
                backgroundColor: burst.color,
                opacity,
                transform: [{ translateX }, { translateY }, { scale: opacity }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function CanvasScreen({ records, toast, onEnableNotifications }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const dayMap = useMemo(() => groupRecordsByDay(records), [records]);
  const weeks = useMemo(() => buildCalendarWeeks(), []);

  const detail = useMemo(() => {
    if (toast) return toast;
    if (!selectedDay) {
      return records.length ? '点击一个格子查看记录时间' : '还没有记录。去记录页打一发情绪子弹。';
    }
    const record = latestRecord(dayMap[selectedDay]);
    if (!record) return `${selectedDay} 未记录`;
    return `${record.emoji} ${formatRecordTime(record.timestamp)} 触发`;
  }, [dayMap, records.length, selectedDay, toast]);

  return (
    <ScrollView style={styles.canvas} contentContainerStyle={styles.canvasContent}>
      <View style={styles.canvasHeader}>
        <View>
          <Text style={styles.kicker}>过去 12 个月</Text>
          <Text style={styles.canvasTitle}>情绪像素画布</Text>
        </View>
        <Pressable style={styles.alarmButton} onPress={onEnableNotifications}>
          <Text style={styles.alarmIcon}>⏰</Text>
        </Pressable>
      </View>

      <View style={styles.statsGrid}>
        {MOODS.map((mood) => (
          <View key={mood.emoji} style={styles.statCard}>
            <Text style={styles.statEmoji}>{mood.emoji}</Text>
            <Text style={styles.statCount}>{records.filter((item) => item.emoji === mood.emoji).length}</Text>
            <Text style={styles.statLabel}>{mood.detail}</Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.calendarScroller}>
        <View style={styles.calendarRow}>
          <View style={styles.weekdayLabels}>
            {['', '一', '', '三', '', '五', ''].map((label, index) => (
              <Text key={`${label}-${index}`} style={styles.weekdayText}>{label}</Text>
            ))}
          </View>
          <View style={styles.weeks}>
            {weeks.map((week, weekIndex) => (
              <View key={weekIndex} style={styles.week}>
                {week.map((day) => {
                  const key = dayKey(day);
                  const record = latestRecord(dayMap[key]);
                  const mood = MOODS.find((item) => item.emoji === record?.emoji);
                  const selected = selectedDay === key;
                  return (
                    <Pressable
                      key={key}
                      accessibilityLabel={record ? `${key} ${record.emoji}` : `${key} 未记录`}
                      style={[
                        styles.dayCell,
                        { backgroundColor: mood?.color || '#222832' },
                        selected && styles.dayCellSelected,
                      ]}
                      onPress={() => setSelectedDay(key)}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <Text style={styles.detailBox}>{detail}</Text>
    </ScrollView>
  );
}

async function loadRecords() {
  try {
    const info = await FileSystem.getInfoAsync(RECORD_FILE);
    if (!info.exists) return [];
    const raw = await FileSystem.readAsStringAsync(RECORD_FILE);
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRecords(records) {
  await FileSystem.writeAsStringAsync(RECORD_FILE, JSON.stringify(records, null, 2));
}

async function scheduleMoodNotifications() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('moodbullet', {
      name: 'MoodBullet',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180],
      lightColor: '#ffd447',
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') {
    Alert.alert('通知未开启', '请在系统设置中允许 MoodBullet 发送通知。');
    return '通知权限未开启';
  }

  await Notifications.cancelAllScheduledNotificationsAsync();
  await scheduleDaily(15, 0);
  await scheduleDaily(21, 0);
  return '已开启 15:00 和 21:00 本地提醒';
}

async function scheduleDaily(hour, minute) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'MoodBullet',
      body: REMINDER_COPY[Math.floor(Math.random() * REMINDER_COPY.length)],
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
      channelId: Platform.OS === 'android' ? 'moodbullet' : undefined,
    },
  });
}

function groupRecordsByDay(records) {
  return records.reduce((map, record) => {
    const key = dayKey(new Date(record.timestamp));
    map[key] = [...(map[key] || []), record];
    return map;
  }, {});
}

function latestRecord(records = []) {
  return records.reduce((latest, record) => {
    if (!latest || record.timestamp > latest.timestamp) return record;
    return latest;
  }, null);
}

function buildCalendarWeeks() {
  const today = startOfDay(new Date());
  const start = new Date(today);
  start.setDate(today.getDate() - 371);
  while (start.getDay() !== 1) {
    start.setDate(start.getDate() - 1);
  }

  const weeks = [];
  for (let week = 0; week < 54; week += 1) {
    const days = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      days.push(date);
    }
    weeks.push(days);
  }
  return weeks;
}

function dayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatRecordTime(timestamp) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function seeded(seed) {
  const value = Math.sin(seed * 999) * 10000;
  return value - Math.floor(value);
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#090b10',
  },
  app: {
    flex: 1,
    backgroundColor: '#090b10',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 10,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f7fb',
  },
  brandMarkText: {
    color: '#090b10',
    fontWeight: '900',
    fontSize: 12,
  },
  brandText: {
    color: '#f5f7fb',
    fontSize: 17,
    fontWeight: '800',
  },
  tabs: {
    width: 136,
    padding: 4,
    borderRadius: 8,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  tab: {
    flex: 1,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#f5f7fb',
  },
  tabText: {
    color: '#9ba7b8',
    fontSize: 13,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#090b10',
  },
  capture: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    gap: 22,
  },
  timeChip: {
    color: '#9ba7b8',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: '#f5f7fb',
    fontSize: 48,
    lineHeight: 50,
    fontWeight: '900',
    textAlign: 'center',
  },
  moodGrid: {
    width: '100%',
    maxWidth: 390,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  moodButton: {
    width: '48.5%',
    height: 136,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  moodButtonWide: {
    width: '100%',
    height: 112,
  },
  moodButtonPressed: {
    transform: [{ scale: 0.96 }],
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  moodEmoji: {
    fontSize: 58,
    lineHeight: 68,
  },
  moodLabel: {
    color: '#9ba7b8',
    fontSize: 13,
    fontWeight: '800',
  },
  savedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,11,16,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedEmoji: {
    fontSize: 126,
    lineHeight: 140,
  },
  savedText: {
    color: '#9ba7b8',
    fontSize: 17,
    fontWeight: '800',
  },
  particle: {
    position: 'absolute',
    borderRadius: 99,
  },
  canvas: {
    flex: 1,
  },
  canvasContent: {
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 32,
    gap: 20,
  },
  canvasHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  kicker: {
    color: '#9ba7b8',
    fontSize: 12,
    fontWeight: '800',
  },
  canvasTitle: {
    color: '#f5f7fb',
    fontSize: 35,
    fontWeight: '900',
  },
  alarmButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  alarmIcon: {
    fontSize: 22,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    width: '48.7%',
    minHeight: 98,
    borderRadius: 8,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  statEmoji: {
    fontSize: 22,
  },
  statCount: {
    color: '#f5f7fb',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  statLabel: {
    color: '#9ba7b8',
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
  },
  calendarScroller: {
    marginHorizontal: -2,
  },
  calendarRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 2,
  },
  weekdayLabels: {
    gap: 5,
  },
  weekdayText: {
    width: 22,
    height: 16,
    color: '#9ba7b8',
    fontSize: 10,
    fontWeight: '800',
  },
  weeks: {
    flexDirection: 'row',
    gap: 5,
  },
  week: {
    gap: 5,
  },
  dayCell: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  dayCellSelected: {
    borderColor: '#f5f7fb',
    borderWidth: 2,
  },
  detailBox: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 8,
    overflow: 'hidden',
    color: '#9ba7b8',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
