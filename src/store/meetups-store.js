import { writable } from "svelte/store";


const meetups = writable([]);

const customMeetupStore = {
  subscribe: meetups.subscribe,
  setMeetups: (meetupArray) => {
    meetups.set(meetupArray);
  },
  addMeetup: (meetupData) => {
    const newMeetup = {
      ...meetupData
    };
    meetups.update((items) => {
      return [newMeetup, ...items];
    });
  },
  updateMeetup: (id, meetupData) => {
    meetups.update(items => {
      const indexOfItemToBeEdited = items.findIndex(i => i.id === id);
      const updatedMeetup = {...items[indexOfItemToBeEdited], ...meetupData};
      const updatedMeetups = [...items];
      updatedMeetups[indexOfItemToBeEdited] = updatedMeetup;
      return updatedMeetups;
    });
  },
  deleteMeetup: (id) => {
    meetups.update(items => {
      return items.filter(item => item.id !== id);
    });
  },
  toggleFavorite: (id) => {
    meetups.update((items) => {
      const updatedMeetup = {...items.find(meetUp => meetUp.id === id)};
      updatedMeetup.isFavorite = !updatedMeetup.isFavorite;
      const meetUpIndex = items.findIndex(meetUp => meetUp.id === id);
      const updatedMeetups = [...items];
      updatedMeetups[meetUpIndex] = updatedMeetup;
      return updatedMeetups;
    });
  }
};

export default customMeetupStore;