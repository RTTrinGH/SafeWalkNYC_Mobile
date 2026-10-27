import React, { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PlaceField from './PlaceField';
import { describeLocation } from '../lib/geocode';
import {
  PLACE_ICONS,
  SavedPlace,
  Settings,
  useStore,
} from '../lib/store';
import { Theme, radius } from '../theme';

type Props = { t: Theme; visible: boolean; onClose: () => void };

type Draft = {
  id?: string;
  name: string;
  icon: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
};

const BLANK: Draft = { name: '', icon: '⭐', address: '', latitude: null, longitude: null };

export default function SettingsModal({ t, visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const { settings, places, update, savePlace, removePlace, resetSettings, clearPlaces } = useStore();
  const [draft, setDraft] = useState<Draft | null>(null);

  const home = places.find((p) => p.name.toLowerCase() === 'home');
  const work = places.find((p) => p.name.toLowerCase() === 'work');
  const others = places.filter((p) => p !== home && p !== work);

  const edit = (p: SavedPlace) =>
    setDraft({
      id: p.id,
      name: p.name,
      icon: p.icon,
      address: p.address,
      latitude: p.latitude,
      longitude: p.longitude,
    });

  const confirmRemove = (p: SavedPlace) =>
    Alert.alert(`Remove ${p.name}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => removePlace(p.id) },
    ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.fill, { backgroundColor: t.paper }]}>
        <View style={[styles.header, { borderBottomColor: t.rule }]}>
          <Text style={[styles.title, { color: t.ink }]}>{draft ? (draft.id ? 'Edit place' : 'New place') : 'Settings'}</Text>
          <Pressable
            onPress={() => (draft ? setDraft(null) : onClose())}
            hitSlop={12}
            accessibilityRole="button"
          >
            <Text style={{ color: t.blue, fontWeight: '700', fontSize: 16 }}>{draft ? 'Cancel' : 'Done'}</Text>
          </Pressable>
        </View>

        {draft ? (
          <PlaceEditor
            t={t}
            draft={draft}
            setDraft={setDraft}
            onSave={() => {
              if (!draft.name.trim()) return Alert.alert('Give it a name', 'For example "Gym" or "Mom\'s".');
              if (draft.latitude === null || draft.longitude === null) {
                return Alert.alert('Choose an address', 'Pick one of the suggestions so we know where it is.');
              }
              savePlace({
                id: draft.id,
                name: draft.name.trim(),
                icon: draft.icon,
                address: draft.address,
                latitude: draft.latitude,
                longitude: draft.longitude,
              });
              setDraft(null);
            }}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <Heading t={t}>Saved places</Heading>
            <Card t={t}>
              <PlaceRow
                t={t}
                icon="🏠"
                label="Home"
                place={home}
                onAdd={() => setDraft({ ...BLANK, name: 'Home', icon: '🏠' })}
                onEdit={edit}
                onRemove={confirmRemove}
              />
              <PlaceRow
                t={t}
                icon="💼"
                label="Work"
                place={work}
                onAdd={() => setDraft({ ...BLANK, name: 'Work', icon: '💼' })}
                onEdit={edit}
                onRemove={confirmRemove}
              />
              {others.map((p) => (
                <PlaceRow
                  key={p.id}
                  t={t}
                  icon={p.icon}
                  label={p.name}
                  place={p}
                  onAdd={() => {}}
                  onEdit={edit}
                  onRemove={confirmRemove}
                />
              ))}
              <Pressable
                onPress={() => setDraft({ ...BLANK })}
                style={[styles.addRow, { borderTopColor: t.rule }]}
                accessibilityRole="button"
              >
                <Text style={{ color: t.blue, fontWeight: '700' }}>＋ Add a place</Text>
              </Pressable>
            </Card>
            <Hint t={t}>Tap a saved place on the map screen to go there. Press and hold one to start from it.</Hint>

            <Heading t={t}>Emergency</Heading>
            <Card t={t}>
              <ToggleRow
                t={t}
                label="Show 911 button"
                detail="Turn off to remove it from the walking panel."
                value={settings.showEmergency}
                onChange={(v) => update({ showEmergency: v })}
              />
              <ToggleRow
                t={t}
                label="Hold to call 911"
                detail="Press and hold before the confirmation appears, so it can never be tapped by accident."
                value={settings.holdToCall}
                disabled={!settings.showEmergency}
                onChange={(v) => update({ holdToCall: v })}
              />
              <Segmented
                t={t}
                label="Hold time"
                disabled={!settings.showEmergency || !settings.holdToCall}
                value={String(settings.holdMs)}
                options={[
                  ['500', 'Short'],
                  ['800', 'Medium'],
                  ['1200', 'Long'],
                ]}
                onChange={(v) => update({ holdMs: Number(v) })}
              />
            </Card>

            <Heading t={t}>Emergency contact</Heading>
            <Card t={t}>
              <Field
                t={t}
                label="Name"
                value={settings.contactName}
                placeholder="Someone who should know you're out"
                onChangeText={(v) => update({ contactName: v })}
              />
              <Field
                t={t}
                label="Phone"
                value={settings.contactPhone}
                placeholder="(555) 123-4567"
                keyboardType="phone-pad"
                onChangeText={(v) => update({ contactPhone: v })}
              />
            </Card>
            <Hint t={t}>
              With a contact set, "Text" sends them your walk and location in one tap, and "Call" rings them.
            </Hint>

            <Heading t={t}>Map</Heading>
            <Card t={t}>
              <ToggleRow
                t={t}
                label="Safe places"
                detail="Police, ERs, subway and fire stations."
                value={settings.showHavens}
                onChange={(v) => update({ showHavens: v })}
              />
              <ToggleRow
                t={t}
                label="Recent incidents"
                detail="Red dots near your route."
                value={settings.showIncidents}
                onChange={(v) => update({ showIncidents: v })}
              />
              <ToggleRow
                t={t}
                label="Follow me while walking"
                detail="Keep the map centered on you."
                value={settings.followWhileWalking}
                onChange={(v) => update({ followWhileWalking: v })}
              />
            </Card>

            <Heading t={t}>Planning</Heading>
            <Card t={t}>
              <Segmented
                t={t}
                label="Leave"
                value={settings.defaultDeparture}
                options={[
                  ['now', 'Now'],
                  ['night', 'Tonight 10 PM'],
                ]}
                onChange={(v) => update({ defaultDeparture: v as Settings['defaultDeparture'] })}
              />
              <ToggleRow
                t={t}
                label="Warn me after dark"
                detail="A reminder when a walk falls between 8 PM and 6 AM."
                value={settings.nightWarning}
                onChange={(v) => update({ nightWarning: v })}
              />
            </Card>

            <Heading t={t}>General</Heading>
            <Card t={t}>
              <Segmented
                t={t}
                label="Appearance"
                value={settings.appearance}
                options={[
                  ['system', 'Auto'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ]}
                onChange={(v) => update({ appearance: v as Settings['appearance'] })}
              />
              <Segmented
                t={t}
                label="Units"
                value={settings.units}
                options={[
                  ['imperial', 'Miles'],
                  ['metric', 'Kilometers'],
                ]}
                onChange={(v) => update({ units: v as Settings['units'] })}
              />
              <ToggleRow
                t={t}
                label="Haptic feedback"
                detail="Small taps for turns and button presses."
                value={settings.haptics}
                onChange={(v) => update({ haptics: v })}
              />
            </Card>

            <Heading t={t}>Data</Heading>
            <Card t={t}>
              <ActionRow
                t={t}
                label="Delete all saved places"
                onPress={() =>
                  Alert.alert('Delete all saved places?', 'This cannot be undone.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: clearPlaces },
                  ])
                }
              />
              <ActionRow
                t={t}
                label="Reset settings"
                onPress={() =>
                  Alert.alert('Reset all settings?', 'Saved places are kept.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Reset', style: 'destructive', onPress: resetSettings },
                  ])
                }
              />
            </Card>
            <Hint t={t}>
              Everything on this screen is stored only on this phone. Risk scores come from public NYPD complaint data
              and are a guide, not a guarantee.
            </Hint>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

function PlaceEditor({
  t,
  draft,
  setDraft,
  onSave,
}: {
  t: Theme;
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [keyboardUp, setKeyboardUp] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKeyboardUp(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const useHere = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return Alert.alert('Location is off', 'Allow location in Settings to use this.');
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { latitude, longitude } = fix.coords;
      const address = await describeLocation(latitude, longitude).catch(() => 'My location');
      setDraft({ ...draft, address, latitude, longitude });
    } catch {
      Alert.alert('Could not get your location');
    }
  };

  return (
    <View style={styles.fill}>
      {keyboardUp && (
        <Pressable
          onPress={Keyboard.dismiss}
          style={[styles.keyboardBar, { backgroundColor: t.surface, borderBottomColor: t.rule }]}
          accessibilityRole="button"
          accessibilityLabel="Hide keyboard"
        >
          <Text style={{ color: t.blue, fontWeight: '700' }}>Hide keyboard ⌄</Text>
        </Pressable>
      )}
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 120 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <Heading t={t}>Name</Heading>
      <Card t={t}>
        <Field
          t={t}
          label=""
          value={draft.name}
          placeholder="Gym, Mom's, School…"
          onChangeText={(name) => setDraft({ ...draft, name })}
        />
      </Card>

      <Heading t={t}>Icon</Heading>
      <View style={styles.icons}>
        {PLACE_ICONS.map((icon) => {
          const active = draft.icon === icon;
          return (
            <Pressable
              key={icon}
              onPress={() => setDraft({ ...draft, icon })}
              style={[
                styles.iconCell,
                {
                  backgroundColor: active ? t.blueTint : t.surface,
                  borderColor: active ? t.blue : t.rule,
                },
              ]}
              accessibilityLabel={`Icon ${icon}`}
            >
              <Text style={{ fontSize: 24 }}>{icon}</Text>
            </Pressable>
          );
        })}
      </View>

      <Heading t={t}>Address</Heading>
      <PlaceField
        t={t}
        label="Search for an address"
        dot={t.orange}
        includeSaved={false}
        persistResults
        value={draft.address}
        onChangeText={(address) => setDraft({ ...draft, address, latitude: null, longitude: null })}
        onPick={(p) =>
          setDraft({
            ...draft,
            address: p.secondary ? `${p.primary}, ${p.secondary}` : p.primary,
            latitude: p.latitude,
            longitude: p.longitude,
          })
        }
      />
      <Pressable onPress={useHere} style={styles.hereButton} accessibilityRole="button">
        <Text style={{ color: t.blue, fontWeight: '700' }}>Use my current location</Text>
      </Pressable>
      {draft.latitude !== null && (
        <Text style={{ color: t.green, marginTop: 6, fontWeight: '600', fontSize: 13 }}>✓ Location set</Text>
      )}

      <Pressable
        onPress={onSave}
        style={[styles.save, { backgroundColor: t.blue }]}
        accessibilityRole="button"
      >
        <Text style={{ color: t.onAccent, fontWeight: '800', fontSize: 16 }}>Save place</Text>
      </Pressable>
    </ScrollView>
    </View>
  );
}

/* ----- small building blocks ------------------------------------------- */

function Heading({ t, children }: { t: Theme; children: string }) {
  return <Text style={[styles.heading, { color: t.ink3 }]}>{children.toUpperCase()}</Text>;
}

function Hint({ t, children }: { t: Theme; children: string }) {
  return <Text style={[styles.hint, { color: t.ink3 }]}>{children}</Text>;
}

function Card({ t, children }: { t: Theme; children: React.ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.rule }]}>{children}</View>
  );
}

function ToggleRow({
  t,
  label,
  detail,
  value,
  onChange,
  disabled,
}: {
  t: Theme;
  label: string;
  detail?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, { borderTopColor: t.rule, opacity: disabled ? 0.45 : 1 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
        {!!detail && <Text style={[styles.detail, { color: t.ink3 }]}>{detail}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: t.blue, false: t.ruleStrong }}
      />
    </View>
  );
}

function Segmented({
  t,
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  t: Theme;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.row, styles.segRow, { borderTopColor: t.rule, opacity: disabled ? 0.45 : 1 }]}>
      <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
      <View style={[styles.seg, { backgroundColor: t.surfaceSunk }]}>
        {options.map(([key, text]) => {
          const active = key === value;
          return (
            <Pressable
              key={key}
              disabled={disabled}
              onPress={() => onChange(key)}
              style={[styles.segItem, active && { backgroundColor: t.surface }]}
            >
              <Text style={{ color: active ? t.blue : t.ink2, fontWeight: '700', fontSize: 13 }}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function Field({
  t,
  label,
  value,
  placeholder,
  onChangeText,
  keyboardType,
}: {
  t: Theme;
  label: string;
  value: string;
  placeholder?: string;
  onChangeText: (v: string) => void;
  keyboardType?: 'default' | 'phone-pad';
}) {
  return (
    <View style={[styles.row, { borderTopColor: t.rule }]}>
      {!!label && <Text style={[styles.label, { color: t.ink, width: 64 }]}>{label}</Text>}
      <TextInput
        style={[styles.input, { color: t.ink }]}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={t.ink3}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        autoCorrect={false}
      />
    </View>
  );
}

function ActionRow({ t, label, onPress }: { t: Theme; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.row, { borderTopColor: t.rule }]} accessibilityRole="button">
      <Text style={[styles.label, { color: t.red }]}>{label}</Text>
    </Pressable>
  );
}

function PlaceRow({
  t,
  icon,
  label,
  place,
  onAdd,
  onEdit,
  onRemove,
}: {
  t: Theme;
  icon: string;
  label: string;
  place?: SavedPlace;
  onAdd: () => void;
  onEdit: (p: SavedPlace) => void;
  onRemove: (p: SavedPlace) => void;
}) {
  return (
    <Pressable
      onPress={() => (place ? onEdit(place) : onAdd())}
      style={[styles.row, { borderTopColor: t.rule }]}
      accessibilityRole="button"
    >
      <Text style={{ fontSize: 22, width: 34 }}>{place?.icon ?? icon}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: t.ink }]}>{label}</Text>
        <Text style={[styles.detail, { color: place ? t.ink3 : t.blue }]} numberOfLines={1}>
          {place ? place.address : `Set ${label.toLowerCase()}`}
        </Text>
      </View>
      {place && (
        <Pressable onPress={() => onRemove(place)} hitSlop={12} accessibilityLabel={`Remove ${label}`}>
          <Text style={{ color: t.red, fontWeight: '700' }}>Remove</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 20, fontWeight: '800' },
  heading: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginTop: 22, marginBottom: 8, marginLeft: 4 },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 8, marginHorizontal: 4 },
  card: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  segRow: { justifyContent: 'space-between' },
  label: { fontSize: 16, fontWeight: '600' },
  detail: { fontSize: 13, marginTop: 2, lineHeight: 17 },
  input: { flex: 1, fontSize: 16, paddingVertical: 6 },
  seg: { flexDirection: 'row', borderRadius: radius.sm, padding: 2 },
  segItem: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm - 2 },
  addRow: { padding: 14, borderTopWidth: StyleSheet.hairlineWidth },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  iconCell: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardBar: {
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hereButton: { marginTop: 12, paddingVertical: 4 },
  save: {
    marginTop: 28,
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
